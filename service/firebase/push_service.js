const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

const RESOURCES_DIR = path.join(__dirname, "../../resources");

const FIREBASE_APP_TARGETS = {
  customer: {
    appName: "helppr-customer",
    expectedProjectId: "helper-user-app",
    expectedSenderId: "637181315442",
    paths: [
      path.join(RESOURCES_DIR, "adminsdk-customer.json"),
      path.join(RESOURCES_DIR, "adminsdk-user.json"),
      path.join(RESOURCES_DIR, "adminsdk.json"),
    ],
  },
  partner: {
    appName: "helppr-partner",
    expectedProjectId: null,
    expectedSenderId: null,
    paths: [
      path.join(RESOURCES_DIR, "adminsdk-partner.json"),
      path.join(RESOURCES_DIR, "adminsdk.json"),
    ],
  },
};

const readyApps = new Set();
const appMetadata = {};

const loadServiceAccount = (filePath) => {
  if (!fs.existsSync(filePath)) return null;
  try {
    const serviceAccount = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!serviceAccount?.project_id || !serviceAccount?.private_key) {
      console.error(
        `[firebase] invalid service account file (missing project_id/private_key): ${path.basename(filePath)}`
      );
      return null;
    }
    return serviceAccount;
  } catch (error) {
    console.error(
      `[firebase] failed to parse ${path.basename(filePath)}:`,
      error.message || error
    );
    return null;
  }
};

const initFirebaseApp = (target) => {
  const config = FIREBASE_APP_TARGETS[target];
  if (!config) return false;

  for (const filePath of config.paths) {
    const serviceAccount = loadServiceAccount(filePath);
    if (!serviceAccount) continue;

    try {
      admin.initializeApp(
        {
          credential: admin.credential.cert(serviceAccount),
        },
        config.appName
      );
      readyApps.add(target);
      appMetadata[target] = {
        ready: true,
        projectId: serviceAccount.project_id,
        clientEmail: serviceAccount.client_email || null,
        sourceFile: path.basename(filePath),
        expectedProjectId: config.expectedProjectId,
        expectedSenderId: config.expectedSenderId,
        projectMatchesCustomerApp:
          config.expectedProjectId == null
            ? null
            : serviceAccount.project_id === config.expectedProjectId,
      };
      console.log(
        `[firebase] ${target} push initialized (${path.basename(filePath)}) project_id=${serviceAccount.project_id}`
      );
      return true;
    } catch (error) {
      if (error?.code === "app/duplicate-app") {
        readyApps.add(target);
        return true;
      }
      console.error(
        `[firebase] failed to initialize ${target} from ${filePath}:`,
        error.message || error
      );
    }
  }

  appMetadata[target] = {
    ready: false,
    projectId: null,
    clientEmail: null,
    sourceFile: null,
    expectedProjectId: config.expectedProjectId,
    expectedSenderId: config.expectedSenderId,
    projectMatchesCustomerApp: null,
  };
  return false;
};

Object.keys(FIREBASE_APP_TARGETS).forEach((target) => {
  initFirebaseApp(target);
});

if (!readyApps.size) {
  console.warn(
    "Firebase service account files not found. Push notifications are disabled."
  );
  console.warn(
    "Expected: resources/adminsdk-customer.json and resources/adminsdk-partner.json"
  );
}

const resolveFirebaseTarget = (target) => {
  const normalized = String(target || "").trim().toLowerCase();
  if (normalized === "customer" || normalized === "user") return "customer";
  if (normalized === "partner") return "partner";
  return null;
};

const getFirebaseDiagnostics = () => ({
  customer: appMetadata.customer || { ready: readyApps.has("customer") },
  partner: appMetadata.partner || { ready: readyApps.has("partner") },
  customerAppReference: {
    projectId: "helper-user-app",
    senderId: "637181315442",
    androidPackage: "com.helppr",
  },
  hint:
    "messaging/mismatched-credential means the deviceToken was issued by a different Firebase project than the loaded service account. Customer tokens require project_id helper-user-app (sender 637181315442).",
});

const sendPushNotification = async ({
  deviceToken,
  title,
  body,
  data = {},
  target = "customer",
}) => {
  const firebaseTarget = resolveFirebaseTarget(target);
  if (!firebaseTarget || !readyApps.has(firebaseTarget)) {
    const expectedFile =
      firebaseTarget === "partner"
        ? "resources/adminsdk-partner.json"
        : "resources/adminsdk-customer.json";
    throw new Error(
      `Firebase is not configured for ${firebaseTarget || target}. Missing ${expectedFile}.`
    );
  }

  const appName = FIREBASE_APP_TARGETS[firebaseTarget].appName;
  const message = {
    token: deviceToken,
    notification: {
      title,
      body,
    },
    data: {
      click_action: "FLUTTER_NOTIFICATION_CLICK",
      ...data,
    },
    android: {
      priority: "high",
    },
    apns: {
      payload: {
        aps: {
          sound: "default",
          contentAvailable: true,
        },
      },
    },
  };

  const response = await admin.app(appName).messaging().send(message);
  console.log(`Successfully sent ${firebaseTarget} message:`, response);
  return response;
};

const safeSendPushNotification = async (payload) => {
  try {
    const messageId = await sendPushNotification(payload);
    return { ok: true, messageId: messageId || null };
  } catch (error) {
    console.error("Push notification failed:", error.message || error);
    return {
      ok: false,
      error: error.message || String(error),
      code: error.code || error.errorInfo?.code || null,
    };
  }
};

const mapUserTypeToFirebaseTarget = (userType) => {
  switch (Number(userType)) {
    case 4:
      return "customer";
    case 2:
      return "partner";
    default:
      return null;
  }
};

module.exports = {
  sendPushNotification,
  safeSendPushNotification,
  mapUserTypeToFirebaseTarget,
  getFirebaseDiagnostics,
};
