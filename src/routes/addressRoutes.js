import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import {
  getAddresses,
  getAddressById,
  createAddress,
  updateAddress,
  deleteAddress,
  setDefaultAddress,
} from "../controllers/addressController.js";

const router = express.Router();

// All address operations require authenticated user
router.use(protect);

router.route("/").get(getAddresses).post(createAddress);
router
  .route("/:id")
  .get(getAddressById)
  .put(updateAddress)
  .delete(deleteAddress);
router.route("/:id/default").patch(setDefaultAddress);

export default router;
