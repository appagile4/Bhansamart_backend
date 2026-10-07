import mongoose from "mongoose";

const reviewSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: [true, "Product reference is required"],
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
      index: true,
    },
    userName: {
      type: String,
      required: [true, "User name is required"],
      trim: true,
      default: "Customer",
    },
    userAvatar: {
      type: String,
      default: "",
    },
    rating: {
      type: Number,
      required: [true, "Rating between 1 and 5 is required"],
      min: [1, "Rating must be at least 1"],
      max: [5, "Rating cannot exceed 5"],
    },
    comment: {
      type: String,
      required: [true, "Review comment is required"],
      trim: true,
    },
    isVerifiedBuyer: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// Static method to recalculate average ratings
reviewSchema.statics.calcAverageRatings = async function (productId) {
  try {
    const stats = await this.aggregate([
      { $match: { product: new mongoose.Types.ObjectId(productId) } },
      {
        $group: {
          _id: "$product",
          nRating: { $sum: 1 },
          avgRating: { $avg: "$rating" },
        },
      },
    ]);

    if (stats.length > 0) {
      await mongoose.model("Product").findByIdAndUpdate(productId, {
        ratingsCount: stats[0].nRating,
        ratingsAverage: Math.round(stats[0].avgRating * 10) / 10,
      });
    } else {
      await mongoose.model("Product").findByIdAndUpdate(productId, {
        ratingsCount: 0,
        ratingsAverage: 0,
      });
    }
  } catch (err) {
    console.error("Error calculating average rating:", err);
  }
};

reviewSchema.post("save", function () {
  this.constructor.calcAverageRatings(this.product);
});

reviewSchema.post("findOneAndDelete", function (doc) {
  if (doc) {
    doc.constructor.calcAverageRatings(doc.product);
  }
});

const Review = mongoose.model("Review", reviewSchema);

export default Review;
