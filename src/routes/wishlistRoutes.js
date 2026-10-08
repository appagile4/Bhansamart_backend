import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import {
  getWishlist,
  toggleWishlist,
  addToWishlist,
  removeFromWishlist,
  clearWishlist,
} from "../controllers/wishlistController.js";

const router = express.Router();

// All wishlist routes require authentication
router.use(protect);

router.route("/").get(getWishlist);
router.route("/toggle").post(toggleWishlist);
router.route("/add").post(addToWishlist);
router.route("/remove/:productId").delete(removeFromWishlist);
router.route("/clear").delete(clearWishlist);

export default router;
