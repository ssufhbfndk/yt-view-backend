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

// Middleware
app.use(express.json());
app.use(cors({ origin: "http://localhost:3000", credentials: true }));
app.use(sessionMiddleware);

// Test Route
app.get("/", (req, res) => res.send("✅ Server is Running!"));

// Routes
//app.use("/api/auth", authRoutes);
app.use("/api/user", userRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/clientUser", clientUser)
console.log("✅ Admin Routes Loaded");
console.log("✅ Base Path: /api/admin");

// Global Error Handler
app.use((err, req, res, next) => {
  console.error("❌ Server Error:", err.message);
  res.status(500).json({ success: false, message: "Internal Server Error" });
});

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
