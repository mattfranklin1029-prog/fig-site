const { Router } = require("express");
const router = Router();

// GET /about
router.get("/about", (req, res) => {
  res.send("This is the about page!");
});

// Dynamic route: /hello/:name
router.get("/hello/:name", (req, res) => {
  res.send(`Hello ${req.params.name}!`);
});

module.exports = router;