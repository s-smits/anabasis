// fwsim test fixture. IN_PIN is mirrored on OUT_PIN, and each change is reported on Serial with
// one ADC reading; HB_PIN toggles every 100 ms with a "beat" line; each received byte is echoed.
#if defined(ARDUINO_ARCH_AVR)
const int IN_PIN = 2, OUT_PIN = 13, HB_PIN = 8, ADC_PIN = A0;
#elif defined(ARDUINO_ARCH_RP2040)
const int IN_PIN = 2, OUT_PIN = 25, HB_PIN = 14, ADC_PIN = A0;
#elif defined(ARDUINO_ARCH_ESP32)
const int IN_PIN = 4, OUT_PIN = 2, HB_PIN = 16, ADC_PIN = 34;
#endif

int last;
int beat = 0;
unsigned long nextBeat;

void setup() {
  Serial.begin(115200);
  while (!Serial) {}  // USB serial (rp2040) drops output until the host opens the port
  pinMode(IN_PIN, INPUT);
  pinMode(OUT_PIN, OUTPUT);
  pinMode(HB_PIN, OUTPUT);
  last = digitalRead(IN_PIN);
  digitalWrite(OUT_PIN, last);
  Serial.println("ready");
  nextBeat = millis() + 100;
}

void loop() {
  int level = digitalRead(IN_PIN);
  if (level != last) {
    last = level;
    digitalWrite(OUT_PIN, level);
    Serial.print("in=");
    Serial.print(level);
    Serial.print(" adc=");
    Serial.println(analogRead(ADC_PIN));
  }
  if (millis() >= nextBeat) {
    nextBeat += 100;
    beat = !beat;
    digitalWrite(HB_PIN, beat);
    Serial.print("beat ");
    Serial.println(beat);
  }
  while (Serial.available() > 0) {
    Serial.print("rx=");
    Serial.println((char)Serial.read());
  }
}
