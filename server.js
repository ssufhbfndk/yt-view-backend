const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const bodyParser = require("body-parser");
const clientUser = require("./routes/clientUser")
const userRoutes = require("./routes/userRoutes");
const orderRoutes = require("./routes/orderRoutes");
const adminRoutes = require("./routes/adminRoutes");
const sessionMiddleware = require("./middleware/sessionMiddleware");
const cookieParser = require("cookie-parser");

dotenv.config();
const app = express();
const PORT = process.env.PORT || 5000;

app.use(bodyParser.json());
app.use(cookieParser()); // 🔹 Ensure cookies can be parsed

app.use(cors({
  origin: [
    "https://yt-view-front.vercel.app",
    "https://yt-view-front-ssufhbfndks-projects.vercel.app"
  ],
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

// ✅ Fixing CORS Headers Issue
app.use((req, res, next) => {
  const allowedOrigins = [
    "https://yt-view-front.vercel.app",
    "https://yt-view-front-ssufhbfndks-projects.vercel.app"
  ];
  const origin = allowedOrigins.includes(req.headers.origin) ? req.headers.origin : allowedOrigins[0];
  res.header("Access-Control-Allow-Origin", origin);
  res.header("Access-Control-Allow-Credentials", "true");
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Expose-Headers", "Set-Cookie"); 
  next();
});


app.use(sessionMiddleware); // ✅ Ensuring session middleware comes before routes
app.use(express.json());

// Routes
app.use("/api/user", userRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/clientUser", clientUser);

// Global Error Handler
app.use((err, req, res, next) => {
  console.error("❌ Server Error:", err.message);
  res.status(500).json({ success: false, message: "Internal Server Error" });
});

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
