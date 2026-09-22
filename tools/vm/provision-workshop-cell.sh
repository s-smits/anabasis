#!/usr/bin/env bash
# Provision a disposable guest for the Builder's correctness-model workshop.
#
# The workshop is the one cell that runs third-party package lifecycle code. Under Seatbelt or
# Bubblewrap that code shares the host kernel; this guest gives it a machine of its own. The
# design follows an earlier VM provisioner by the same operator (2026-08-19): Ubuntu cloud image
# on a qcow2 backing file, cloud-init, per-VM ssh key, virtiofs share, snapshot-revert
# disposability. Two things differ for Anabasis: the guest carries the workshop's toolchain instead of
# an agent, and after provisioning its NIC moves to a host-only network with no forward element,
# because the workshop policy says network: "deny" and the runner measures that with domiflist.
#
# Usage:
#   provision-workshop-cell.sh <name> [--memory MB] [--vcpus N] [--disk GB] [--image URL]
#
# Then:  export ANA_WORKSHOP_VM=<name>   (and ANA_VM_DIR if the location was overridden)
#
set -euo pipefail

NAME=""
MEMORY=8192
VCPUS=4
DISK=40
IMAGE_URL="https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img"
NETWORK="ana-isolated"
# Under /var/lib/libvirt/images rather than $HOME: on AppArmor systems virt-aa-helper grants
# /var/lib/libvirt/images/** and denies most of /home, so a disk under a home directory fails to
# start with a "Permission denied" that no chmod fixes.
VM_DIR="${ANA_VM_DIR:-/var/lib/libvirt/images/ana}"

die() { echo "provision-workshop-cell: $*" >&2; exit 1; }
usage() { sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }
v() { virsh -c qemu:///system "$@"; }

[ $# -gt 0 ] || usage 1
NAME=$1; shift
case "$NAME" in -*) usage 1 ;; esac
# The name becomes a domain name, a directory, a hostname and the guest username.
[[ "$NAME" =~ ^[a-z0-9][a-z0-9-]*$ ]] || die "name must be lowercase alphanumeric with dashes"

while [ $# -gt 0 ]; do
  case "$1" in
    --memory) MEMORY=$2; shift 2 ;;
    --vcpus)  VCPUS=$2; shift 2 ;;
    --disk)   DISK=$2; shift 2 ;;
    --image)  IMAGE_URL=$2; shift 2 ;;
    -h|--help) usage 0 ;;
    *) die "unknown option: $1" ;;
  esac
done

# --- preflight ---------------------------------------------------------------
for tool in virsh virt-install qemu-img genisoimage ssh-keygen curl; do
  command -v "$tool" >/dev/null || die "missing $tool

On Debian/Ubuntu:
  sudo apt install -y qemu-system-x86 libvirt-daemon-system libvirt-clients virtinst genisoimage
  sudo usermod -aG kvm,libvirt \$USER   # then log out and back in

The package is qemu-system-x86, not qemu-kvm: the latter is a removed transitional package and
apt aborts the whole install rather than skip it."
done

[ -e /dev/kvm ] || die "/dev/kvm missing — enable virtualisation in firmware (AMD-V / VT-x)"
groups | grep -qw libvirt || die "not in the libvirt group; run: sudo usermod -aG libvirt \$USER (then re-login)"
v list >/dev/null 2>&1 || die "cannot reach qemu:///system — is libvirtd running?"
v dominfo "$NAME" >/dev/null 2>&1 && die "domain '$NAME' already exists"

if [ ! -d "$VM_DIR" ] || [ ! -w "$VM_DIR" ]; then
  die "cannot write to $VM_DIR

One-time setup:
  sudo mkdir -p $VM_DIR
  sudo chgrp libvirt $VM_DIR && sudo chmod 2775 $VM_DIR

Set ANA_VM_DIR to override. Avoid \$HOME: virt-aa-helper cannot read there."
fi

INSTANCE_DIR="$VM_DIR/$NAME"
SHARE_DIR="$INSTANCE_DIR/share"
mkdir -p "$INSTANCE_DIR" "$SHARE_DIR"
# The guest user (uid 1000, first cloud-init user) writes the share through virtiofs passthrough
# as that host uid. The common single-user host matches; warn instead of failing when it does not.
[ "$(id -u)" = "1000" ] || echo "note: your uid is $(id -u); guest writes land as uid 1000, so the share may need wider modes"

# --- host-only network -------------------------------------------------------
# No <forward> element means no route off the host: the guest reaches the host (ssh, DHCP) and
# nothing else. This is what lets the runner honour the workshop policy's network: "deny".
SEED_DIR=$(mktemp -d)
trap 'rm -rf "$SEED_DIR"' EXIT
if ! v net-info "$NETWORK" >/dev/null 2>&1; then
  cat > "$SEED_DIR/net.xml" <<XML
<network>
  <name>$NETWORK</name>
  <bridge name="virbr-ana" stp="on" delay="0"/>
  <ip address="192.168.222.1" netmask="255.255.255.0">
    <dhcp><range start="192.168.222.100" end="192.168.222.254"/></dhcp>
  </ip>
</network>
XML
  v net-define "$SEED_DIR/net.xml" >/dev/null
  v net-autostart "$NETWORK" >/dev/null
fi
v net-info "$NETWORK" | grep -q "Active:.*yes" || v net-start "$NETWORK" >/dev/null
NETWORK_XML=$(v net-dumpxml "$NETWORK") || die "cannot read network '$NETWORK'"
if grep -Eq '<forward([[:space:]>])' <<< "$NETWORK_XML"; then
  die "network '$NETWORK' has a forward route; remove or rename it before provisioning"
fi

echo "==> base image"
BASE="$VM_DIR/$(basename "$IMAGE_URL")"
if [ ! -f "$BASE" ]; then
  curl -fL --progress-bar -o "$BASE.part" "$IMAGE_URL" && mv "$BASE.part" "$BASE"
else
  echo "    cached: $BASE"
fi

echo "==> disk"
# Backing file: every guest after the first costs only what it writes and the base stays pristine.
qemu-img create -f qcow2 -F qcow2 -b "$BASE" "$INSTANCE_DIR/disk.qcow2" "${DISK}G" >/dev/null

echo "==> access key"
KEY="$INSTANCE_DIR/id_ed25519"
[ -f "$KEY" ] || ssh-keygen -t ed25519 -f "$KEY" -N "" -C "ana-workshop-$NAME" -q
# ssh reports a group-readable key as an authentication failure, not a permissions one.
chmod 600 "$KEY"

echo "==> cloud-init"
{
  echo "#cloud-config"
  echo "hostname: $NAME"
  echo "manage_etc_hosts: true"
  echo "users:"
  echo "  - name: $NAME"
  echo "    shell: /bin/bash"
  echo "    groups: [sudo]"
  echo "    sudo: [\"ALL=(ALL) NOPASSWD:ALL\"]"
  echo "    lock_passwd: false"
  echo "    ssh_authorized_keys: [\"$(cat "$KEY.pub")\"]"
  # A console password so virsh console still works if the guest's networking breaks.
  echo "chpasswd: {expire: false, list: \"$NAME:$NAME\\nroot:$NAME\"}"
  echo "package_update: true"
  # The workshop's own toolchain: what its cell commands and package lifecycle scripts need.
  echo "packages: [bubblewrap, curl, git, unzip, build-essential, python3-pip, python3-venv, file, binutils, xxd, jq, ripgrep, nodejs, npm]"
  # /srv/share, not the home directory: systemd creates a missing mountpoint parent before
  # cloud-init creates the user, and a home created by systemd is root-owned.
  echo "mounts:"
  echo "  - [share, /srv/share, virtiofs, \"defaults,nofail\", \"0\", \"0\"]"
  echo "runcmd:"
  echo "  - [bash, -lc, \"chown $NAME:$NAME /home/$NAME\"]"
} > "$SEED_DIR/user-data"
printf 'instance-id: %s\nlocal-hostname: %s\n' "$NAME" "$NAME" > "$SEED_DIR/meta-data"
genisoimage -output "$INSTANCE_DIR/seed.iso" -volid cidata -joliet -rock \
  "$SEED_DIR/user-data" "$SEED_DIR/meta-data" >/dev/null 2>&1

echo "==> creating domain (on NAT for provisioning only)"
# virtiofs needs shared memory backing; without it the filesystem device fails at start with a
# message that does not mention memory. Provisioning runs on the default NAT network because the
# package installs need a mirror; the NIC moves to $NETWORK before the clean snapshot below.
virt-install --connect qemu:///system --name "$NAME" \
  --memory "$MEMORY" --vcpus "$VCPUS" --cpu host-passthrough \
  --memorybacking access.mode=shared \
  --disk "path=$INSTANCE_DIR/disk.qcow2,format=qcow2,bus=virtio" \
  --disk "path=$INSTANCE_DIR/seed.iso,device=cdrom" \
  --filesystem "type=mount,accessmode=passthrough,driver.type=virtiofs,source=$SHARE_DIR,target=share" \
  --os-variant ubuntu24.04 --network network=default,model=virtio \
  --graphics none --console pty,target_type=serial --import --noautoconsole >/dev/null

echo "==> waiting for an address"
IP=""
for _ in $(seq 60); do
  IP=$(v domifaddr "$NAME" 2>/dev/null | awk '/ipv4/{print $4}' | cut -d/ -f1 | head -1)
  [ -n "$IP" ] && break
  sleep 5
done
[ -n "$IP" ] || die "no address after 5 minutes; check: virsh -c qemu:///system console $NAME"

echo "==> waiting for cloud-init (packages install here)"
# The status string is parsed rather than trusting `cloud-init status --wait`, whose exit code is
# 2 on "degraded done" — finished, with one module non-zero, which an apt mirror hiccup causes.
CI_STATE=""
for _ in $(seq 120); do
  CI_STATE=$(ssh -i "$KEY" -o StrictHostKeyChecking=no -o BatchMode=yes -o ConnectTimeout=5 \
      "$NAME@$IP" "cloud-init status 2>/dev/null | head -1" 2>/dev/null || true)
  case "$CI_STATE" in *done*|*error*) break ;; esac
  sleep 10
done
case "$CI_STATE" in
  *error*) echo "    cloud-init reported errors; continuing — check: cloud-init status --long" ;;
  *done*)  : ;;
  *)       die "cloud-init did not finish; check: virsh -c qemu:///system console $NAME" ;;
esac

echo "==> moving the NIC to $NETWORK and taking the clean snapshot"
v shutdown "$NAME" >/dev/null
for _ in $(seq 60); do
  v domstate "$NAME" | grep -q "shut off" && break
  sleep 2
done
v domstate "$NAME" | grep -q "shut off" || die "guest did not shut off; check: virsh console $NAME"
MAC=$(v domiflist "$NAME" | awk '$2 == "network" {print $5; exit}')
[ -n "$MAC" ] || die "could not read the provisioning interface's MAC"
v detach-interface "$NAME" network --mac "$MAC" --config >/dev/null
v attach-interface "$NAME" network "$NETWORK" --model virtio --config >/dev/null
# Shut off is required: a running snapshot saves memory state via migration, and migration is not
# supported for a domain with a virtiofs device.
v snapshot-create-as "$NAME" clean >/dev/null
v start "$NAME" >/dev/null

cat <<EOF

  domain    $NAME
  network   $NETWORK (host-only: the guest reaches this host and nothing else)
  ssh       ssh -i $KEY $NAME@<address from: virsh -c qemu:///system domifaddr $NAME>
  console   virsh -c qemu:///system console $NAME
  share     $SHARE_DIR  <->  /srv/share

  use       export ANA_WORKSHOP_VM=$NAME$( [ "$VM_DIR" != "/var/lib/libvirt/images/ana" ] && printf '; export ANA_VM_DIR=%s' "$VM_DIR" )

  revert    virsh -c qemu:///system destroy $NAME
            virsh -c qemu:///system snapshot-revert $NAME clean
            virsh -c qemu:///system start $NAME

  destroy   virsh -c qemu:///system destroy $NAME
            virsh -c qemu:///system undefine $NAME --remove-all-storage --snapshots-metadata
EOF
