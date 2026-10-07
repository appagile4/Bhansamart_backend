import { Router } from "express";
import {
  createProductReview,
  getProductReviews,
  deleteReview,
} from "../controllers/reviewController.js";
import { protect, optionalAuth } from "../middleware/authMiddleware.js";

const router = Router({ mergeParams: true });

// 1. Get all reviews for a product & Create review
router
  .route("/")
  .get(getProductReviews)
  .post(optionalAuth, createProductReview);

// 2. Delete review (Vendor or authenticated user)
router
  .route("/:reviewId")
  .delete(protect, deleteReview);

export default router;
