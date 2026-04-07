import functions_framework
import os
from firebase_admin import credentials, firestore, initialize_app, _apps

def init_firebase():
    if not _apps:
        # Use a relative path for the key file uploaded with the code
        cred_path = 'devlogai-29a17-firebase-adminsdk-fbsvc-3968e9e6f6.json'
        if os.path.exists(cred_path):
            cred = credentials.Certificate(cred_path)
            initialize_app(cred)
        else:
            initialize_app()

@functions_framework.http
def handle_chat_event(request):
    # This will show up in your Google Cloud Logs
    print("--- NEW CHAT EVENT RECEIVED ---")
    
    event = request.get_json(silent=True)
    if not event:
        print("Error: No JSON payload found.")
        return {"text": "Error: I received an empty request."}

    print(f"Event Type: {event.get('type')}")
    
    try:
        init_firebase()
        db = firestore.client()

        if event.get('type') == 'MESSAGE':
            msg = event.get('message', {})
            text = msg.get('text', 'No text found')
            user = msg.get('sender', {}).get('displayName', 'Unknown')
            
            print(f"Processing message from {user}: {text}")

            db.collection("chat_logs").add({
                "content": text,
                "user": user,
                "timestamp": firestore.SERVER_TIMESTAMP,
                "source": "Google Chat"
            })
            
            # This is the formatted JSON Google Chat expects
            return {"text": f"✅ Got it, {user}! Logged to DevLog AI."}

    except Exception as e:
        print(f"CRASH ERROR: {str(e)}")
        return {"text": f"⚠️ Internal Error: {str(e)}"}

    return {"text": "I am online and listening."}
