const express = require("express");
const path = require("path");

const app = express();

// Static folder
app.use(express.static(path.join(__dirname, "public-download")));

// APK download route
app.get("/download-apk", (req, res) => {

    const filePath = path.join(
        __dirname,
        "public-download",
        "ythub.1.3.12.apk"
    );

    res.download(filePath, "ythub.1.3.12.apk", (err) => {

        if (err) {

            // User cancelled download
            if (err.code === "ECONNABORTED") {
                console.log("User aborted download");
                return;
            }

            console.log("Download error:", err);

            // Prevent headers error
            if (!res.headersSent) {
                return res.status(404).send("APK file not found");
            }
        }

    });

});

// Homepage
app.get("/", (req, res) => {
    res.sendFile(
        path.join(__dirname, "public-download", "index.html")
    );
});

app.listen(4000, () => {
    console.log("Download server running on 4000");
});