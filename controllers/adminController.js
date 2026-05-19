const db = require("../config/db");
const jwt = require("jsonwebtoken");
const admin = require("../firebaseAdmin");
const SECRET_KEY = process.env.SESSION_SECRET || "supersecretkey";

const generateToken = (admin) => {
  return jwt.sign(
    {
      id: admin.id,
      username: admin.username,
      lastActivity: Date.now()
    },
    SECRET_KEY,
    { expiresIn: "7d" }
  );
};

// =========================
// 🔹 ADMIN notiftion
// =========================


exports.sendBroadcastNotification =
async (req, res) => {

    try {

        const {
            title,
            body
        } = req.body;

        // validation
        if (!title || !body) {

            return res.status(400).json({

                success: false,
                message: "Title and body required"
            });
        }

        const message = {

            notification: {

                title: title,
                body: body
            },

            topic: "all_users"
        };

        // SEND
        const response =
            await admin.messaging().send(message);

        res.status(200).json({

            success: true,

            message: "Broadcast sent successfully",

            responseId: response
        });

    } catch (error) {

        console.log(error);

        res.status(500).json({

            success: false,

            message: "Broadcast failed"
        });
    }
};
// =========================
// 🔹 ADMIN LOGIN
// =========================
exports.login = async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({
      success: false,
      message: "Username and password are required."
    });
  }

  try {

    const results = await db.queryAsync(
      "SELECT * FROM adminuser WHERE username = ? LIMIT 1",
      [username]
    );

    // ❌ username not found
    if (!results || results.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Username not found or invalid credentials."
      });
    }

    const admin = results[0];

    // ❌ password wrong
    if (admin.password !== password) {
      return res.status(401).json({
        success: false,
        message: "Password is incorrect."
      });
    }

    const token = generateToken(admin);

    res.cookie("admin_token", token, {
      httpOnly: true,
      secure: true,
      sameSite: "None",
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    return res.json({
      success: true,
      message: "Admin logged in.",
      admin: {
        id: admin.id,
        name:admin.name,
        username: admin.username
      }
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Database error."
    });
  }
};

// =========================
// 🔹 ADMIN LOGOUT
// =========================
exports.logout = (req, res) => {
  res.clearCookie("admin_token", {
    httpOnly: true,
    secure: true,
    sameSite: "None"
  });

  return res.json({
    success: true,
    message: "Logged out successfully"
  });
};

// =========================
// 🔹 CHECK ADMIN SESSION
// =========================
exports.checkAdminSession = async (req, res) => {
  const token = req.cookies?.admin_token;

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "No active session."
    });
  }

  try {
    const decoded = jwt.verify(token, SECRET_KEY);

    // 🔥 HERE IS THE IMPORTANT PART
    const user = await db.queryAsync(
      "SELECT id, name, username FROM adminuser WHERE id = ?",
      [decoded.id]
    );

    if (!user || user.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Admin not found"
      });
    }

    return res.json({
      success: true,
      admin: user[0]   // ✅ FULL DATA HERE
    });

  } catch (err) {
    return res.status(403).json({
      success: false,
      message: "Invalid session"
    });
  }
};


exports.changePassword = async (req, res) => {

  const {
    currentPassword,
    newPassword
  } = req.body;

  // =========================
  // VALIDATION
  // =========================
  if (!currentPassword || !newPassword) {
    return res.status(400).json({
      success: false,
      message: "Current password and new password are required."
    });
  }

  try {

    // =========================
    // GET ADMIN ID FROM TOKEN
    // =========================
    const adminId = req.admin.id;

    // =========================
    // FIND ADMIN
    // =========================
    const results = await db.queryAsync(
      "SELECT * FROM adminuser WHERE id=? LIMIT 1",
      [adminId]
    );

    if (!results || results.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Admin not found."
      });
    }

    const admin = results[0];

    // =========================
    // CHECK CURRENT PASSWORD
    // =========================
    if (admin.password !== currentPassword) {
      return res.status(401).json({
        success: false,
        message: "Current password is incorrect."
      });
    }

    // =========================
    // CHECK SAME PASSWORD
    // =========================
    if (currentPassword === newPassword) {
      return res.status(400).json({
        success: false,
        message: "New password must be different."
      });
    }

    // =========================
    // UPDATE PASSWORD
    // =========================
    const updateResult = await db.queryAsync(
      "UPDATE adminuser SET password=? WHERE id=?",
      [newPassword, adminId]
    );

    if (!updateResult) {
      return res.status(500).json({
        success: false,
        message: "Password update failed."
      });
    }

    return res.json({
      success: true,
      message: "Password updated successfully."
    });

  } catch (err) {

    console.log("Change Password Error:", err);

    return res.status(500).json({
      success: false,
      message: "Server error."
    });

  }

};