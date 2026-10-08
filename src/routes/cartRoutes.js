import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import {
  getCart,
  addToCart,
  updateCartItemQuantity,
  removeFromCart,
  clearCart,
  syncCart,
} from "../controllers/cartController.js";

const router = express.Router();

// Protect all cart routes
router.use(protect);

router.route("/").get(getCart);
router.route("/add").post(addToCart);
router.route("/update-quantity").put(updateCartItemQuantity);
router.route("/remove/:productId").delete(removeFromCart);
router.route("/clear").delete(clearCart);
router.route("/sync").post(syncCart);

export default router;
