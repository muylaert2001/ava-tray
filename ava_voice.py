
import sounddevice as sd
import numpy as np
import wave, tempfile, os, time, json
import urllib.request, requests, pyttsx3

SAMPLE_RATE = 16000
DEVICE_INDEX = 1
AVA_API = "http://127.0.0.1:7878"
GOOGLE_KEY = "AIzaSyBOti4mM-6x9WDnZIjIeyEU21OpBXqWBgw"
WAKE_WORDS = ["hey ava", "ok ava", "okay ava"]

tts = pyttsx3.init()
tts.setProperty("rate", 165)
voices = tts.getProperty("voices")
for v in voices:
    if "zira" in v.name.lower() or "aria" in v.name.lower():
        tts.setProperty("voice", v.id)
        break

def speak(text):
    print("AVA:", text)
    tts.say(text)
    tts.runAndWait()

def record_audio(duration=2.5):
    audio = sd.rec(int(duration * SAMPLE_RATE), samplerate=SAMPLE_RATE, channels=1, dtype="int16", device=DEVICE_INDEX)
    sd.wait()
    return audio

def record_command(max_duration=7):
    print('Recording command...')
    audio = sd.rec(int(max_duration * SAMPLE_RATE), samplerate=SAMPLE_RATE, channels=1, dtype='int16', device=DEVICE_INDEX)
    sd.wait()
    return audio

def to_text(audio):
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        p = f.name
    with wave.open(p, "wb") as wf:
        wf.setnchannels(1); wf.setsampwidth(2); wf.setframerate(SAMPLE_RATE)
        wf.writeframes(audio.tobytes())
    try:
        url = f"https://www.google.com/speech-api/v2/recognize?output=json&lang=en-US&key={GOOGLE_KEY}"
        with open(p, "rb") as f:
            data = f.read()
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "audio/l16; rate=16000"})
        res = urllib.request.urlopen(req, timeout=10).read().decode()
        for line in res.strip().split("\n"):
            try:
                parsed = json.loads(line)
                if parsed.get("result"):
                    alts = parsed["result"][0].get("alternative", [])
                    if alts:
                        return alts[0].get("transcript", "").strip()
            except: pass
    except Exception as e:
        print("STT error:", e)
    finally:
        try: os.unlink(p)
        except: pass
    return None

def send_to_ava(text):
    print("Sending to AVA:", text)
    try:
        r = requests.post(f"{AVA_API}/voice-input", json={"text": text}, timeout=30)
        if r.ok:
            return r.json().get("response", "")
    except Exception as e:
        print("AVA error:", e)
    return None

def listen_for_wake():
    while True:
        try:
            audio = record_audio(2.5)
            text = to_text(audio)
            if text:
                tl = text.lower()
                print("Heard:", tl)
                if any(tl == w or tl.startswith(w + " ") or tl.endswith(" " + w) or (" " + w + " ") in tl for w in WAKE_WORDS):
                    return True
        except Exception as e:
            pass
        time.sleep(0.1)

def session():
    time.sleep(1.0)
    audio = record_command()
    text = to_text(audio)
    if not text:
        return
    print("You said:", text)
    try:
        requests.post(f"{AVA_API}/voice-transcript", json={"text": text}, timeout=5)
    except: pass
    response = send_to_ava(text)
    if response:
        speak(response)
        time.sleep(4.0)
    else:
        speak("I am having trouble connecting.")

print("AVA Voice Engine starting...")
speak("AVA voice engine online. Say hey AVA to activate.")
print("Listening for wake word...")
while True:
    try:
        if listen_for_wake():
            print("Wake word detected!")
            session()
            print("Listening for wake word...")
    except KeyboardInterrupt:
        speak("Shutting down.")
        break
    except Exception as e:
        print("Error:", e)
        time.sleep(1)
