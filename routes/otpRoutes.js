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

        const normalizedEmail =
            email.toLowerCase().trim();

        // ================================
        // EMAIL VALIDATION
        // ================================
        const emailRegex =
            /^[A-Za-z0-9._%+-]+@gmail\.com$/;

        if (!emailRegex.test(normalizedEmail)) {

            return res.status(400).json({
                success: false,
                message: "Invalid Gmail address"
            });
        }

        // ================================
        // CHECK USER
        // ================================
        const users = await queryAsync(`
            SELECT id, username, email
            FROM user
            WHERE email = ?
            LIMIT 1
        `, [normalizedEmail]);

        if (users === null) {

            return res.status(500).json({
                success: false,
                message: "Database busy"
            });
        }

        if (!users.length) {

            return res.status(404).json({
                success: false,
                message: "Email not registered"
            });
        }

        const user = users[0];

        // ================================
        // RATE LIMIT
        // ================================
        const existingOTP =
            otpStore[normalizedEmail];

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
        // SAVE OTP
        // ================================
        otpStore[normalizedEmail] = {

            otp,

            expires:
                Date.now() + 5 * 60 * 1000,

            lastSent:
                Date.now(),

            attempts: 0
        };

        // ================================
        // SEND EMAIL
        // ================================
        await transporter.sendMail({

            from: `"YT Hub" <${process.env.EMAIL_USER}>`,

            to: normalizedEmail,

            subject: "YT Hub Password Reset OTP",

            html: `

<!DOCTYPE html>
<html>

<head>
<meta charset="UTF-8">
<title>YT Hub OTP</title>
</head>

<body style="
    margin:0;
    padding:0;
    background:#f4f4f4;
    font-family:Arial,sans-serif;
">

<div style="
    max-width:600px;
    margin:40px auto;
    background:#ffffff;
    border-radius:12px;
    overflow:hidden;
    box-shadow:0 0 10px rgba(0,0,0,0.1);
">

    <!-- HEADER -->
    <div style="
        background:#9B27B0;
        padding:30px;
        text-align:center;
    ">

        <h1 style="
            color:#ffffff;
            margin:0;
            font-size:32px;
        ">
            YT Hub
        </h1>

    </div>

    <!-- BODY -->
    <div style="
        padding:40px;
        color:#333333;
    ">

        <h2 style="
            margin-top:0;
            color:#9B27B0;
        ">
            Password Reset Request
        </h2>

        <p style="
            font-size:16px;
            line-height:26px;
        ">
            Hello <b>${user.username}</b>,
        </p>

        <p style="
            font-size:16px;
            line-height:26px;
        ">
            We received a request to reset your YT Hub account password.
        </p>

        <p style="
            font-size:16px;
            line-height:26px;
        ">
            Use the OTP below to continue:
        </p>

        <!-- OTP BOX -->
        <div style="
            margin:30px 0;
            text-align:center;
        ">

            <div style="
                display:inline-block;
                background:#f3e5f5;
                color:#9B27B0;
                font-size:38px;
                font-weight:bold;
                letter-spacing:10px;
                padding:18px 35px;
                border-radius:10px;
            ">
                ${otp}
            </div>

        </div>

        <p style="
            font-size:15px;
            color:#666666;
            line-height:24px;
        ">
            This OTP will expire in
            <b>5 minutes</b>.
        </p>

        <p style="
            font-size:15px;
            color:#666666;
            line-height:24px;
        ">
            If you did not request a password reset,
            you can safely ignore this email.
        </p>

    </div>

    <!-- FOOTER -->
    <div style="
        background:#fafafa;
        padding:20px;
        text-align:center;
        font-size:13px;
        color:#999999;
    ">

        © ${new Date().getFullYear()} YT Hub
        <br>
        Secure Authentication System

    </div>

</div>

</body>
</html>

            `
        });

        return res.json({
            success: true,
            message: "OTP sent successfully"
        });

    } catch (err) {

        console.log(
            "❌ OTP SEND ERROR:",
            err.message
        );

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