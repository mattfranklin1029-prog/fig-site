const { Router } = require("express");
const router = Router();

// GET /api/family
router.get("/", (req, res) => {
  res.json([
    { name: "Matt", age: 52 },
    { name: "Kenzie", age: 22 },
    { name: "Preston", age: 17 },
  ]);
});

module.exports = router;