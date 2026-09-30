# fwsim

`fwsim` runs a compiled firmware image on a simulated board, applies scripted input at chosen
virtual times, and prints what the firmware did: pin transitions, serial lines and I2C transfers,
each stamped in virtual microseconds from reset. The same image, stimulus and `--until-us` give the
same trace on every run (ESP32 within the tolerance below).

Install it into the workspace once, from the workspace root:

```sh
sh starter-pack/fwsim/install.sh
```

The installer places fwsim in `.toolchain/fwsim` and writes the wrapper `.toolchain/bin/fwsim`.
It uses `.toolchain/bun`, or `bun` on PATH, with `HOME` set to `.toolchain/home`. Dependencies are
pinned exactly (`avr8js` 0.21.1, `rp2040js` 1.4.0), and running it again replaces the install in
place. ESP32 also needs Espressif's `qemu-system-xtensa`; see ESP32 below.

## Command

```
fwsim run --board esp32|rp2040|uno --image <file> [--stimulus <stimulus.json>] --until-us <n>
          [--out <trace.json>] [--pins <n,n,...>] [--qemu <qemu-system-xtensa>] [--wall-ms <n>]
```

- `--until-us`: how long to run, in virtual microseconds (1 to 3.6e9).
- `--pins`: trace only these pins. A check's tool stdout is capped at 1 MiB, so filter any
  firmware that toggles pins quickly or runs for a long time.
- `--out`: write the trace to a file and print only a summary line, `{"out","pins","serial","exit"}`.
- `--qemu`, `--wall-ms`: ESP32 only. `--qemu` names the QEMU binary; `--wall-ms` is the host
  wall-clock budget.

Exit status:

- 0: a trace was printed, whatever the firmware did. A crash is `exit.reason: "crash"`, not a
  failed run.
- 2: the invocation, image or stimulus is wrong, for example a pin the board lacks or an unknown
  key. Nothing goes to stdout.
- 3: the simulator is missing, failed, or cannot apply this stimulus. Nothing goes to stdout.
- 1: an internal error.

Exit statuses 2 and 3 are never a verdict on the firmware. A check that gets one must throw, not
return false.

## Images

| board    | image                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------ |
| `uno`    | the `.ino.hex` arduino-cli writes (Intel HEX), or a raw binary up to 32 KiB                             |
| `rp2040` | the `.ino.bin` (raw flash from 0x10000000) or the `.ino.uf2`                                            |
| `esp32`  | the `.ino.merged.bin`, or the `.ino.bin` with its `.ino.bootloader.bin` and `.ino.partitions.bin` beside it |

For ESP32, build with `FlashMode=dio`. QEMU does not emulate QIO flash, and fwsim adds that cause
to the crash detail when a QIO image faults.

## Stimulus (`--stimulus`, JSON)

```json
{
  "events": [
    { "atUs": 0, "kind": "adc", "pin": 26, "value": 2048 },
    { "atUs": 250000, "kind": "gpio", "pin": 2, "level": 1 },
    { "atUs": 300000, "kind": "uart", "text": "hi\n", "port": "usb", "baud": 115200 },
    { "atUs": 350000, "kind": "i2c", "address": 72, "register": 0, "value": 25 }
  ],
  "devices": [{ "kind": "i2c", "address": 72, "registers": [25, 0] }]
}
```

- `atUs`: virtual microseconds from reset, resolved to whole nanoseconds. Events apply in time
  order, and events with the same time keep their file order.
- `gpio`: drives input `pin` to `level` 0 or 1 from `atUs` on. Before its first `gpio` event, an
  input reads high if the firmware enabled its pull-up and low otherwise (Uno, RP2040). On ESP32 it
  reads low.
- `adc`: takes `channel` or `pin` (not both) and a raw `value`, which reads until the next
  `adc` event on that channel. The range is 0 to 1023 on Uno and 0 to 4095 on RP2040 and ESP32.
- `uart`: sends the UTF-8 bytes of `text`, one character time (10 bits at `baud`, default 115200)
  apart. `port` defaults to the board's first port.
- `i2c` and `devices`: each device is a register-map target at a 7-bit address (0x08 to 0x77). The
  first byte written sets the register pointer, and each byte then read or written moves it on by
  one. An `i2c` event changes one register at its time. The firmware reading or writing an
  undeclared address gets a NACK.

Unknown keys, out-of-range pins or values, and a port or device the board lacks all exit 2.

## Trace (stdout, JSON)

```json
{
  "board": "uno",
  "untilUs": 400000,
  "clock": "virtual",
  "pins": [{ "atUs": 250012.5, "pin": 13, "level": 1 }],
  "serial": [{ "atUs": 250201.25, "port": "uart0", "text": "in=1 adc=512" }],
  "i2c": [{ "atUs": 1204.75, "address": 72, "op": "read", "bytes": [25, 0] }],
  "exit": { "reason": "until", "atUs": 400000, "detail": null }
}
```

- `pins`: one row per change, sorted by time and then pin. `level` is 1 or 0 while the firmware
  drives the pin as a GPIO output, and `null` while it does not: as an input, when released, or
  when a peripheral owns it. Every pin starts at `null`, and only changes are listed.
- `serial`: one row per line the firmware printed. A line ends at `\n`, and a `\r` just before it
  is dropped. `atUs` is when its last byte was written. Text is UTF-8, or Latin-1 when the bytes are
  not valid UTF-8. A final line with no newline is still listed.
- `i2c`: one row per completed transfer to a declared device.
- `exit.reason`:
  - `until` when `--until-us` was reached.
  - `crash`: the firmware faulted. `atUs` and `detail` give the time and cause.
  - `wall`: the host wall budget ran out first (ESP32 only).
- `clock` is `virtual` whenever `atUs` values are virtual time, and `none` on stock ESP32 QEMU,
  where every `atUs` is `null`.

## Boards: exactly what is and is not simulated

### `uno`: ATmega328P at 16 MHz under avr8js 0.21.1

One CPU cycle is 62.5 ns of virtual time.

Simulated:

- **Pins**: GPIO on Arduino pins 0 to 19, where A0 to A5 are 14 to 19.
- **ADC**: channels 0 to 5 (A0 to A5), 10-bit against a 5 V reference.
- **Serial**: USART0 as `uart0`, both output and input. Input is paced and dropped while the
  receiver is disabled.
- **Peripherals**: timers 0 to 2, so `millis`, `delay` and `micros` work. Also the watchdog,
  1 KiB of EEPROM, and TWI master to declared I2C devices.

Not simulated:

- SPI is present but reads 0.
- No analog comparator, fuses or bootloader: the image runs from address 0.
- PWM compare outputs (`analogWrite`, `tone`) are left to avr8js and are not exercised by fwsim's
  tests.

**Crash**: the program counter leaves the loaded image.

### `rp2040`: RP2040 under rp2040js 1.4.0, with the B1 bootrom

Virtual time follows the CPU cycle count at the system clock the firmware configures.

Simulated:

- **Pins**: GPIO 0 to 29.
- **ADC**: channels 0 to 3 on GPIO 26 to 29, plus channel 4, the temperature sensor. It reads 0
  unless a stimulus sets it.
- **Serial**:
  - USB CDC as `usb`, the arduino-pico `Serial`. TinyUSB's own enumeration fix drives GPIO 15
    briefly at start-up.
  - UART0 and UART1 as `uart0` and `uart1`, for `Serial1` and `Serial2`.
- **Peripherals**:
  - I2C0 and I2C1 master to declared devices.
  - Timers and alarms.
  - PIO, all 8 state machines, stepped in lockstep with the CPU at their clock dividers.

Not simulated:

- Core 0 only: core 1, multicore FIFOs and lockout do not run.
- SPI reads 0.
- Other rp2040js peripherals (DMA, PWM, RTC, watchdog) run as rp2040js models them and are not
  exercised by fwsim's tests.

**Crash**: a HardFault, an unaligned word read, a breakpoint (`bkpt`, which pico-sdk's `panic`
ends in), or the program counter leaving the bootrom, flash or SRAM. A PIO program that uses
something rp2040js does not model exits 3.

### `esp32`: ESP32 under Espressif's `qemu-system-xtensa`

QEMU runs with `-icount shift=3,sleep=off`. fwsim reads UART and GPIO writes from QEMU's trace log.

fwsim looks for the binary in this order:

1. `--qemu`
2. `.toolchain/qemu/bin`
3. `.toolchain/qemu/libexec`
4. `.toolchain/bin`
5. PATH

ROMs are taken from the install's `share/qemu`, or from `pc-bios` in a build tree.

What fwsim can do depends on the binary, which it probes before every run:

- **Stimulus-capable QEMU**: its `esp32.gpio` model has a `stimulus` property, which needs
  Espressif QEMU `esp-develop-9.2.2-20260417` plus this directory's `esp32-input.patch`.
  `sh starter-pack/fwsim/build-qemu.sh` builds it into `.toolchain/qemu`; its header lists what the
  build needs. Runs are timed and take `gpio` and `adc` events.
  - **GPIO input**: pins 0 to 39, including rising, falling, change and level interrupts. Only
    rising and change interrupts on the APP CPU have been exercised.
  - **ADC**: ADC1 only, channels 0 to 7 on GPIO 36, 37, 38, 39, 32, 33, 34 and 35. There is no
    ADC2 and no `analogReadMilliVolts` calibration.
  - **Pull-ups**: not modelled. The stimulus sets each input's idle level.
  - **Pin times** come from QEMU's `esp32_gpio_out` stamps.
  - **Serial times**: this QEMU has no UART trace in virtual time, so a serial line cannot be
    placed exactly. fwsim writes a stimulus marker every 50 µs and stamps each line with the last
    marker before it. A serial `atUs` can therefore be up to 50 µs earlier than the write.
  - **Jitter**: repeat runs differ by up to about ±4 µs in pin times. Stock QEMU shows this too.
    Compare ESP32 times with a tolerance of at least 10 µs for pins, and at least 60 µs for serial
    lines. The order and levels of events do not vary.
  - **Wall time**: one virtual second costs several host seconds. The default `--wall-ms` is
    600000; a run that exhausts it exits `wall`.
- **Stock QEMU** (no `stimulus` property): output only, untimed.
  - Every `atUs` is `null` and `clock` is `none`.
  - The run stops on the host wall budget, `--wall-ms`, default max(2000, until-us / 1000). The
    exit is then `wall`, and only the opening of the run is traced.
  - A stimulus with any event exits 3. That means input is unsupported on this binary; it is not a
    verdict on the firmware.

Simulated in both modes:

- **Pins**: GPIO output latches, set, clear and enable, through the GPIO matrix. A pin routed to
  a peripheral (LEDC, UART, SPI and so on) is traced as `null`.
- **Serial**: UART0 to UART2 output as `uart0`, `uart1` and `uart2`. Only UART0 is tested.
- **I2C**: no I2C devices beyond QEMU's built-in TMP105 temperature sensor. `devices` and `i2c`
  events exit 2.

Not simulated:

- No LEDC, RMT or PCNT.
- No serial input: `uart` events exit 2.
- No Wi-Fi or Bluetooth traffic.
- On stock QEMU, `analogRead` panics ("Guru Meditation … Cache disabled").

**Crash**:

- A crash is a line containing:
  - "Guru Meditation"
  - "abort() was called"
  - "assert failed:"
  - "\*\*\*ERROR\*\*\*"
  - "Brownout"
  - or a second reset banner (`rst:`)
- A panicked QEMU can ignore SIGTERM. At its deadline fwsim sends SIGTERM, then SIGKILL 2 s later,
  and reports the crash it read rather than hanging.

## From a check

A check runs fwsim through the host, never by spawning it, and names it in its required tools.
How the stimulus may reach fwsim depends on the check's evidence:

- **External**: every file the check passes must be a string leaf of the declared artifact or
  public input, byte for byte. A task that states its stimulus as a JSON string can pass that
  string as `stimulus.json`, and the run is recorded against that input path. A stimulus the
  check builds or edits is refused ("not a string leaf or JSON of the declared artifact/public
  input"), and the check throws.
- **Authored**: the check may build the stimulus, and the run is recorded as `authored:derived`.
  The example below builds its stimulus, so it is an authored check.

A binary image, such as an ESP32 or RP2040 `.bin`, cannot be passed through `files`, which holds
strings only. Compile it in the same check with an earlier `runtime.tools.run` of `arduino-cli`,
and fwsim then reads it from the check's working directory.

```ts
// The LED on pin 13 follows a button press on pin 2 at 250 ms within 2 ms.
const stimulus = { events: [{ atUs: 250_000, kind: "gpio", pin: 2, level: 1 }] };
const run = await runtime.tools.run({
  toolId: "fwsim",
  args: ["run", "--board", "uno", "--image", "build/sketch.ino.hex", "--stimulus", "stimulus.json", "--until-us", "400000", "--pins", "13"],
  files: { "stimulus.json": JSON.stringify(stimulus) },
});
if (run.exitCode !== 0) throw new Error(`fwsim produced no trace (exit ${run.exitCode}): ${run.stderr.slice(-400)}`);
const trace = JSON.parse(run.stdout);
const rise = trace.pins.find((row) => row.pin === 13 && row.level === 1 && row.atUs > 250_000);
return rise !== undefined && rise.atUs <= 252_000 && trace.exit.reason === "until";
```

On `esp32`, allow the documented tolerance in every time comparison. Treat `clock: "none"` as
"this binary cannot time", not as a fail.
