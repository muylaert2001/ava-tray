import cv2
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision
import requests
import time
import base64
import os
import threading

BACKEND = "https://ava-assistant.com"
MODEL_PATH = "C:/NOVA/blaze_face_short_range.tflite"

face_present = False
last_seen = 0
absence_threshold = 5
arrival_cooldown = 30

def send_event(event_type, data=None):
    def _send():
        try:
            requests.post(f"{BACKEND}/api/vision/event",
                         json={"event": event_type, "data": data or {}},
                         timeout=10)
            print(f"[AVA Vision] Event sent: {event_type}")
        except Exception as e:
            print(f"[AVA Vision] Failed to send event: {e}")
    threading.Thread(target=_send, daemon=True).start()

def capture_frame_base64(frame):
    _, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
    return base64.b64encode(buffer).decode('utf-8')

print("[AVA Vision] Starting...")

cap = None
for attempt in range(3):
    cap = cv2.VideoCapture(0)
    time.sleep(3)
    if cap.isOpened():
        print(f"[AVA Vision] Camera opened on attempt {attempt+1}")
        break
    print(f"[AVA Vision] Camera attempt {attempt+1} failed, retrying...")
    cap.release()
    time.sleep(5)

if not cap or not cap.isOpened():
    print("ERROR: Could not open webcam after 3 attempts")
    exit()

base_options = mp_python.BaseOptions(model_asset_path=MODEL_PATH)
options = vision.FaceDetectorOptions(base_options=base_options)
detector = vision.FaceDetector.create_from_options(options)

print("[AVA Vision] Watching... (Press Q to quit)")
last_arrival = 0

while True:
    ret, frame = cap.read()
    if not ret:
        break
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
    result = detector.detect(mp_image)
    now = time.time()
    detected = len(result.detections) > 0
    if detected:
        if not face_present:
            if now - last_arrival > arrival_cooldown:
                print("[AVA Vision] Face detected - sending arrival event")
                frame_b64 = capture_frame_base64(frame)
                send_event("arrival", {"image": frame_b64})
                last_arrival = now
        face_present = True
        last_seen = now
    else:
        if face_present and (now - last_seen > absence_threshold):
            print("[AVA Vision] Face gone - sending departure event")
            send_event("departure")
            face_present = False
    status = "PRESENT" if face_present else "AWAY"
    color = (0, 255, 0) if face_present else (0, 0, 255)
    cv2.putText(frame, f'AVA Vision: {status}', (10, 30),
                cv2.FONT_HERSHEY_SIMPLEX, 0.8, color, 2)
    if result.detections:
        for det in result.detections:
            bb = det.bounding_box
            cv2.rectangle(frame, (bb.origin_x, bb.origin_y),
                         (bb.origin_x+bb.width, bb.origin_y+bb.height), (0,255,0), 2)
    cv2.imshow('AVA Vision', frame)
    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

cap.release()
cv2.destroyAllWindows()
print("[AVA Vision] Stopped")