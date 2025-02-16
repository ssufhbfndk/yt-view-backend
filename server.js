const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const bodyParser = require("body-parser");
const clientUser = require("./routes/clientUser")
const userRoutes = require("./routes/userRoutes");
const orderRoutes = require("./routes/orderRoutes");
const adminRoutes = require("./routes/adminRoutes");
const sessionMiddleware = require("./middleware/sessionMiddleware"); // ✅ Correct import



dotenv.config();
const app = express();
const PORT = process.env.PORT || 5000;
app.use(bodyParser.json());


// CORS configuration
app.use(cors({
  origin: [
    'https://yt-view-front.vercel.app', // Allow main frontend URL
    'https://yt-view-front-ssufhbfndks-projects.vercel.app' // Allow preview deployment URL
  ],
  credentials: true // Cookies allow karein
}));

// ✅ Other middlewares (place after CORS)
app.use(express.json());
app.use(sessionMiddleware);



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
