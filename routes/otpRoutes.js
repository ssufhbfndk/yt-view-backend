const express = require("express");
const router = express.Router();
const nodemailer = require("nodemailer");

const otpStore = {};

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// Generate OTP
function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// Send OTP
router.post("/send-otp", async (req, res) => {

    try {

        const { email } = req.body;

        if (!email) {
            return res.status(400).json({
                success: false,
                message: "Email required"
            });
        }

        const otp = generateOTP();

        otpStore[email] = otp;

        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: email,
            subject: "OTP Verification",
            text: `Your OTP is ${otp}`
        });

        res.json({
            success: true,
            message: "OTP Sent"
        });

    } catch (err) {

        console.log(err);

        res.status(500).json({
            success: false,
            message: "Mail send failed"
        });
    }
});

// Verify OTP
router.post("/verify-otp", (req, res) => {

    const { email, otp } = req.body;

    if (otpStore[email] === otp) {

        delete otpStore[email];

        return res.json({
            success: true,
            message: "OTP Verified"
        });
    }

    res.status(400).json({
        success: false,
        message: "Invalid OTP"
    });
});

module.exports = router;