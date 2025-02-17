const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const bodyParser = require("body-parser");
//const sessionMiddleware = require("./config/sessionConfig");
//const authRoutes = require("./routes/authRoutes");
const clientUser = require("./routes/clientUser")
const userRoutes = require("./routes/userRoutes");
const orderRoutes = require("./routes/orderRoutes");
const adminRoutes = require("./routes/adminRoutes");
const sessionMiddleware = require("./middleware/sessionMiddleware"); // ✅ Correct import



dotenv.config();
const app = express();
const PORT = process.env.PORT || 5000;
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true })); // For form data
// Middleware
app.use(express.json());
const corsOptions = {
  origin: [
    'http://localhost:3000', // For local development
    'https://yt-view-front.vercel.app', // For production
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true, // Allow cookies and session data
};

// Use CORS middleware
app.use(cors(corsOptions));

app.use(sessionMiddleware);

// Test Route
app.get("/", (req, res) => res.send("✅ Server is Running!"));

// Routes
//app.use("/api/auth", authRoutes);
app.use("/api/user", userRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/clientUser", clientUser)


// Global Error Handler
app.use((err, req, res, next) => {
  console.error("❌ Server Error:", err.message);
  res.status(500).json({ success: false, message: "Internal Server Error" });
});

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
