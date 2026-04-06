const { onRequest, onCall } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const { google } = require("googleapis");
const { PredictionServiceClient } = require("@google-cloud/aiplatform");
const path = require("path");

// Initialize Firebase Admin
admin.initializeApp();
const db = admin.firestore();

// Path to your service account file
const serviceAccountPath = path.join(__dirname, "service-account.json");

// Helper function to get Vector from Vertex AI
async function getVector(text) {
  const client = new PredictionServiceClient({
    keyFilename: serviceAccountPath,
    apiEndpoint: "us-central1-aiplatform.googleapis.com",
  });

  const project = process.env.GCLOUD_PROJECT;
  const location = "us-central1";
  const publisher = "google";
  const model = "text-embedding-004";
  const endpoint = `projects/${project}/locations/${location}/publishers/${publisher}/models/${model}`;

  const instance = { content: text };
  const [response] = await client.predict({
    endpoint,
    instances: [instance],
  });

  // Extract the embeddings (usually a Float32Array)
  return response.predictions[0].structValue.fields.embeddings.listValue.values.map(v => v.numberValue);
}

/**
 * 1. SYNC FUNCTION: Fetches Google Doc, turns it into a vector, saves to Firestore
 * Trigger via URL: https://<your-url>/processDoc?docId=YOUR_DOC_ID
 */
exports.processDoc = onRequest({ memory: "512MiB" }, async (req, res) => {
  const { docId } = req.query;
  if (!docId) return res.status(400).send("Missing docId in query string");

  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: serviceAccountPath,
      scopes: ["https://www.googleapis.com/auth/drive.readonly"],
    });
    const drive = google.drive({ version: "v3", auth });
    
    // 1. Get the Doc content
    const doc = await drive.files.export({ 
      fileId: docId, 
      mimeType: "text/plain" 
    });
    
    // 2. Get the Embedding (Vector)
    const vector = await getVector(doc.data);
    
    // 3. Force conversion to standard Array for Firestore
    const formattedVector = Array.from(vector);
    
    console.log(`DEBUG: Vector generated with length: ${formattedVector.length}`);

    // 4. Save to Firestore with Vector type
    await db.collection("dev_logs").doc(docId).set({
      content: doc.data,
      embedding: admin.firestore.FieldValue.vector(formattedVector),
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.status(200).send("Sync successful for doc: " + docId);
  } catch (err) {
    console.error("Sync error detail:", err);
    res.status(500).send("Sync Failed: " + err.message);
  }
});

/**
 * 2. SEARCH FUNCTION: Receives a question, searches vectors, returns answer
 */
exports.askDevLog = onCall({ memory: "512MiB" }, async (request) => {
  const userQuery = request.data.query;
  if (!userQuery) throw new Error("No query provided");

  try {
    const queryVector = await getVector(userQuery);

    // Search Firestore for the nearest neighbor
    const snapshot = await db.collection("dev_logs")
      .findNearest("embedding", admin.firestore.FieldValue.vector(Array.from(queryVector)), {
        limit: 1,
        distanceMeasure: "COSINE"
      })
      .get();

    if (snapshot.empty) {
      return { answer: "I couldn't find any relevant logs to answer that." };
    }

    const bestMatch = snapshot.docs[0].data().content;
    return { answer: "Based on your logs: " + bestMatch };
    
  } catch (err) {
    console.error("Search error:", err);
    return { error: err.message };
  }
});