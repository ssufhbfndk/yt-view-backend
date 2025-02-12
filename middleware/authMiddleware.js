exports.protectAdmin = (req, res, next) => {
  if (!req.session.admin) {
    return res.status(401).json({ success: false, message: "Admin Unauthorized" });
  }
  next();
};

exports.protectUser = (req, res, next) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: "User Unauthorized" });
  }
  next();
};
