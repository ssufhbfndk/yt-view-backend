const express = require("express");
const router = express.Router();
const nodemailer = require("nodemailer");

const { queryAsync } = require("../config/db");

const otpStore = {};

// ================================
// MAIL TRANSPORT
// ================================
const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// ================================
// GENERATE OTP
// ================================
function generateOTP() {
    return Math.floor(
        100000 + Math.random() * 900000
    ).toString();
}

// ================================
// SEND OTP
// ================================
router.post("/send-otp", async (req, res) => {

    try {

        const { email } = req.body;

        // ================================
        // VALIDATION
        // ================================
        if (!email) {
            return res.status(400).json({
                success: false,
                message: "Email is required"
            });
        }

        const normalizedEmail = email.toLowerCase().trim();

        // ================================
        // EMAIL FORMAT VALIDATION
        // ================================
        const emailRegex = /^[A-Za-z0-9._%+-]+@gmail\.com$/;

        if (!emailRegex.test(normalizedEmail)) {
            return res.status(400).json({
                success: false,
                message: "Invalid Gmail address"
            });
        }

        // ================================
        // CHECK USER EXISTS BY EMAIL ONLY
        // ================================
        const users = await queryAsync(`
            SELECT id, username, email
            FROM user
            WHERE email = ?
            LIMIT 1
        `, [normalizedEmail]);

        // DB ERROR
        if (users === null) {
            return res.status(500).json({
                success: false,
                message: "Database busy"
            });
        }

        // USER NOT FOUND
        if (!users.length) {
            return res.status(404).json({
                success: false,
                message: "Email not registered"
            });
        }

        const user = users[0];

        // ================================
        // RATE LIMIT (60 sec)
        // ================================
        const existingOTP = otpStore[normalizedEmail];

        if (
            existingOTP &&
            Date.now() - existingOTP.lastSent < 60000
        ) {
            return res.status(429).json({
                success: false,
                message: "Wait 60 seconds before retry"
            });
        }

        // ================================
        // GENERATE OTP
        // ================================
        const otp = generateOTP();

        // ================================
        // STORE OTP
        // ================================
        otpStore[normalizedEmail] = {
            otp,
            expires: Date.now() + 5 * 60 * 1000,
            lastSent: Date.now(),
            attempts: 0
        };

        // ================================
        // SEND EMAIL
        // ================================
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: normalizedEmail,
            subject: "OTP Verification",
            text: `
Hello ${user.username},

Your OTP code is:

${otp}

This OTP will expire in 5 minutes.

If you did not request this, ignore this email.
            `
        });

        return res.json({
            success: true,
            message: "OTP sent successfully"
        });

    } catch (err) {

        console.log("❌ OTP SEND ERROR:", err.message);

        return res.status(500).json({
            success: false,
            message: "Internal server error"
        });
    }
});
// ================================
// VERIFY OTP
// ================================
router.post("/verify-otp", async (req, res) => {

    try {

        const { email, otp } = req.body;

        if (!email || !otp) {

            return res.status(400).json({
                success: false,
                message: "Email and OTP required"
            });
        }

        const normalizedEmail =
            email.toLowerCase().trim();

        const storedOTP =
            otpStore[normalizedEmail];

        // OTP not found
        if (!storedOTP) {

            return res.status(400).json({
                success: false,
                message: "OTP not found"
            });
        }

        // Expired
        if (
            Date.now() > storedOTP.expires
        ) {

            delete otpStore[normalizedEmail];

            return res.status(400).json({
                success: false,
                message: "OTP expired"
            });
        }

        // Too many attempts
        if (storedOTP.attempts >= 5) {

            delete otpStore[normalizedEmail];

            return res.status(429).json({
                success: false,
                message:
                    "Too many attempts"
            });
        }

        // Wrong OTP
        if (storedOTP.otp !== otp) {

            storedOTP.attempts++;

            return res.status(400).json({
                success: false,
                message: "Invalid OTP"
            });
        }

        // SUCCESS
        delete otpStore[normalizedEmail];

        return res.json({
            success: true,
            message:
                "OTP verified successfully"
        });

    } catch (err) {

        console.log(
            "❌ VERIFY ERROR:",
            err.message
        );

        return res.status(500).json({
            success: false,
            message: "Internal server error"
        });
    }
});

module.exports = router;