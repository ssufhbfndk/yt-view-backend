const db = require("../config/db");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");

const SECRET_KEY = process.env.SESSION_SECRET || "supersecretkey";

// ================================
// ✅ LOGIN
// ================================
exports.userClientLogin = async (req, res) => {

  try {

    const {
      username,
      password,
      fcm_token
    } = req.body;

    // Validation
    if (!username || !password) {

      return res.status(400).json({
        success: false,
        message: "Username and Password are required.",
      });
    }

    // =========================
    // 🔥 GET USER
    // =========================
    const results = await db.queryAsync(
      "SELECT * FROM user WHERE username = ?",
      [username]
    );

    if (!results) {

      return res.status(500).json({
        success: false,
        message: "Database busy or down.",
      });
    }

    if (results.length === 0) {

      return res.status(401).json({
        success: false,
        message: "Invalid username or password",
      });
    }

    const user = results[0];

    // =========================
    // 🔥 BLOCK CHECK
    // =========================
    if (user.status === 0 || user.status === false) {

      return res.status(403).json({
        success: false,
        message: "User is blocked by admin.",
      });
    }

    // =========================
    // 🔥 PASSWORD CHECK
    // =========================
    if (!user.password) {

      return res.status(500).json({
        success: false,
        message: "User password not set.",
      });
    }

    const match =
      await bcrypt.compare(
        password,
        user.password
      );

    if (!match) {

      return res.status(401).json({
        success: false,
        message: "Invalid username or password",
      });
    }

    // =========================
    // 🔥 GENERATE JWT TOKEN
    // =========================
    const token = jwt.sign(
      {
        id: user.id,
        username: user.username
      },
      SECRET_KEY
    );

    // =========================
    // 🔥 FCM TOKEN CHECK
    // =========================
    let finalFcmToken =
      user.fcm_token || "";

    // agar new token aaya
    if (fcm_token && fcm_token.trim() !== "") {

      // old aur new compare
      if (user.fcm_token !== fcm_token) {

        // update new token
        await db.queryAsync(
          `
          UPDATE user
          SET
            fcm_token = ?,
            jwt_token = ?,
            token_created_at = NOW()
          WHERE id = ?
          `,
          [
            fcm_token,
            token,
            user.id
          ]
        );

        finalFcmToken = fcm_token;

      } else {

        // same token
        await db.queryAsync(
          `
          UPDATE user
          SET
            jwt_token = ?,
            token_created_at = NOW()
          WHERE id = ?
          `,
          [
            token,
            user.id
          ]
        );
      }

    } else {

      // no fcm token
      await db.queryAsync(
        `
        UPDATE user
        SET
          jwt_token = ?,
          token_created_at = NOW()
        WHERE id = ?
        `,
        [
          token,
          user.id
        ]
      );
    }

    // =========================
    // 🔥 UPDATED USER
    // =========================
    const updatedUser =
      {
        ...user,
        fcm_token: finalFcmToken,
        jwt_token: token
      };

    // =========================
    // ✅ RESPONSE
    // =========================
    res.status(200).json({

      success: true,

      message: "User logged in successfully.",

      user: updatedUser,

      token: token,
    });

  } catch (error) {

    console.log(error);

    res.status(500).json({
      success: false,
      message: "Server error.",
    });
  }
};


// ================================
// ✅ LOGOUT
// ================================
exports.logout = async (req, res) => {
  try {
    let token = null;

    // 1. Cookie
    if (req.cookies && req.cookies.user_token) {
      token = req.cookies.user_token;
    }

    // 2. Header
    if (!token && req.headers.authorization) {
      const parts = req.headers.authorization.split(" ");
      if (parts.length === 2 && parts[0] === "Bearer") {
        token = parts[1];
      }
    }

    // 3. Missing token
    if (!token) {
      return res.status(401).json({
        success: false,
        message: "No token provided.",
      });
    }

    // =========================
    // 🔥 VERIFY TOKEN
    // =========================
    let decoded;
    try {
      decoded = jwt.verify(token, SECRET_KEY);
    } catch (err) {
      return res.clearCookie("user_token").status(401).json({
        success: false,
        message: "Invalid or expired token.",
      });
    }

    if (!decoded?.id) {
      return res.clearCookie("user_token").status(401).json({
        success: false,
        message: "Invalid token.",
      });
    }

    // =========================
    // 🔥 DB UPDATE (SAFE)
    // =========================
    const result = await db.queryAsync(
      "UPDATE user SET jwt_token = NULL, token_created_at = NULL WHERE id = ?",
      [decoded.id]
    );

    if (!result) {
      return res.status(500).json({
        success: false,
        message: "Logout failed.",
      });
    }

    res.clearCookie("user_token");

    res.status(200).json({
      success: true,
      message: "User logged out successfully",
    });

  } catch (err) {
    console.error("Logout error:", err);
    res.status(500).json({
      success: false,
      message: "Server error.",
    });
  }
};


// ================================
// ✅ SESSION CHECK (UNCHANGED)
// ================================
exports.checkUserSession = (req, res) => {
  if (!req.user) {
    return res.status(200).json({
      success: false,
      sessionExpired: true,
      message: "Session expired or not found.",
    });
  }

  return res.status(200).json({
    success: true,
    sessionExpired: false,
    message: "Session is active.",
    user: req.user,
  });
};