import Review from "../models/Review.js";
import Product from "../models/Product.js";

/**
 * @desc    Create a new review for a product
 * @route   POST /api/products/:productId/reviews
 * @access  Public / Authenticated
 */
export const createProductReview = async (req, res, next) => {
  try {
    const { productId } = req.params;
    const { rating, comment, userName, isVerifiedBuyer } = req.body;

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found.",
      });
    }

    const numRating = Number(rating);
    if (!numRating || numRating < 1 || numRating > 5) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid rating between 1 and 5.",
      });
    }

    if (!comment || !comment.trim()) {
      return res.status(400).json({
        success: false,
        message: "Please write a review comment.",
      });
    }

    const reviewerName =
      req.user?.name || req.user?.fullName || userName?.trim() || "Verified Customer";

    const review = await Review.create({
      product: productId,
      user: req.user?._id || req.user?.id || null,
      userName: reviewerName,
      rating: numRating,
      comment: comment.trim(),
      isVerifiedBuyer: isVerifiedBuyer !== undefined ? isVerifiedBuyer : true,
    });

    res.status(201).json({
      success: true,
      message: "Review submitted successfully!",
      review,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get all reviews and rating breakdown for a product
 * @route   GET /api/products/:productId/reviews
 * @access  Public
 */
export const getProductReviews = async (req, res, next) => {
  try {
    const { productId } = req.params;

    const reviews = await Review.find({ product: productId })
      .sort({ createdAt: -1 })
      .lean();

    const total = reviews.length;

    // Calculate rating breakdown (5 star to 1 star)
    const breakdown = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    let sumRating = 0;

    reviews.forEach((r) => {
      const star = Math.min(5, Math.max(1, Math.round(r.rating)));
      breakdown[star] = (breakdown[star] || 0) + 1;
      sumRating += r.rating;
    });

    const averageRating = total > 0 ? Math.round((sumRating / total) * 10) / 10 : 5.0;

    const percentages = {
      5: total > 0 ? Math.round((breakdown[5] / total) * 100) : 0,
      4: total > 0 ? Math.round((breakdown[4] / total) * 100) : 0,
      3: total > 0 ? Math.round((breakdown[3] / total) * 100) : 0,
      2: total > 0 ? Math.round((breakdown[2] / total) * 100) : 0,
      1: total > 0 ? Math.round((breakdown[1] / total) * 100) : 0,
    };

    res.status(200).json({
      success: true,
      count: total,
      averageRating,
      breakdown,
      percentages,
      reviews,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Delete a review (Vendor / Admin / Author permission)
 * @route   DELETE /api/products/:productId/reviews/:reviewId (or DELETE /api/reviews/:id)
 * @access  Private (Vendor / Admin / Author)
 */
export const deleteReview = async (req, res, next) => {
  try {
    const reviewId = req.params.reviewId || req.params.id;

    const review = await Review.findById(reviewId);
    if (!review) {
      return res.status(404).json({
        success: false,
        message: "Review not found.",
      });
    }

    const productId = review.product;

    await Review.findByIdAndDelete(reviewId);

    // Recalculate product rating
    await Review.calcAverageRatings(productId);

    res.status(200).json({
      success: true,
      message: "Review deleted successfully.",
    });
  } catch (error) {
    next(error);
  }
};
