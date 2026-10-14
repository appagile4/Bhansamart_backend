import User from "../models/User.js";
import DeliveryBoy from "../models/DeliveryBoy.js";
import { AppError } from "../middleware/errorMiddleware.js";
import { generateAccessToken, generateTokenAndSetCookie } from "../utils/generateToken.js";

/**
 * Register a new delivery partner
 * POST /api/delivery/auth/register
 */
export const registerDeliveryBoy = async (req, res, next) => {
  try {
    const {
      name,
      email,
      password,
      phone,
      dateOfBirth,
      currentAddress,
      serviceCity,
      serviceArea,
      emergencyContact,
      vehicleDetails,
      bankDetails,
    } = req.body;

    if (!name || !email || !password || !phone) {
      return next(new AppError("Name, email, password, and phone are required", 400));
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email: email.toLowerCase().trim() });
    if (existingUser) {
      return next(new AppError("An account with this email already exists", 400));
    }

    const existingPhone = await DeliveryBoy.findOne({ phone: phone.trim() });
    if (existingPhone) {
      return next(new AppError("A delivery partner with this phone number already exists", 400));
    }

    // Create User record with role 'delivery_boy'
    const newUser = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password,
      phone: phone.trim(),
      role: "delivery_boy",
      status: "pending",
      isApproved: false,
      isActive: true,
    });

    // Create DeliveryBoy profile record
    const deliveryBoy = await DeliveryBoy.create({
      user: newUser._id,
      fullName: name.trim(),
      phone: phone.trim(),
      email: email.toLowerCase().trim(),
      dateOfBirth: dateOfBirth || null,
      currentAddress: currentAddress || {
        addressLine: "",
        city: serviceCity || "Kathmandu",
        state: "Bagmati",
        pincode: "44600",
      },
      serviceCity: serviceCity || "Kathmandu",
      serviceArea: serviceArea || "Central Kathmandu",
      emergencyContact: emergencyContact || { name: "", relationship: "", phone: "" },
      vehicleDetails: vehicleDetails || {
        vehicleType: "Motorcycle",
        registrationNumber: "",
        licenseNumber: "",
      },
      bankDetails: bankDetails || {
        accountHolderName: "",
        accountNumber: "",
        ifscCode: "",
        bankName: "",
        upiId: "",
      },
      approvalStatus: "PENDING_APPROVAL",
      availability: "OFFLINE",
    });

    const token = generateTokenAndSetCookie(res, newUser._id, "delivery_boy");

    res.status(201).json({
      success: true,
      message: "Delivery partner registered successfully. Please submit documents and pay security deposit to activate.",
      token,
      deliveryBoy: deliveryBoy.getMaskedProfile(),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Login delivery partner
 * POST /api/delivery/auth/login
 */
export const loginDeliveryBoy = async (req, res, next) => {
  try {
    const { email, phone, password } = req.body;

    if ((!email && !phone) || !password) {
      return next(new AppError("Please provide email/phone and password", 400));
    }

    // Find user by email or phone
    const query = email
      ? { email: email.toLowerCase().trim() }
      : { phone: phone.trim() };

    const user = await User.findOne(query).select("+password");
    if (!user || user.role !== "delivery_boy") {
      return next(new AppError("Invalid credentials or account is not registered as delivery partner", 401));
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return next(new AppError("Invalid credentials", 401));
    }

    if (!user.isActive) {
      return next(new AppError("Account has been deactivated. Please contact support.", 403));
    }

    const deliveryBoy = await DeliveryBoy.findOne({ user: user._id });
    if (!deliveryBoy) {
      return next(new AppError("Delivery partner profile not found", 404));
    }

    const token = generateTokenAndSetCookie(res, user._id, "delivery_boy");

    res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      deliveryBoy: deliveryBoy.getMaskedProfile(),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get current delivery partner profile
 * GET /api/delivery/auth/me
 */
export const getMyDeliveryProfile = async (req, res, next) => {
  try {
    const deliveryBoy = await DeliveryBoy.findOne({ user: req.user._id }).populate("user", "name email phone isActive status");
    if (!deliveryBoy) {
      return next(new AppError("Delivery partner profile not found", 404));
    }

    res.status(200).json({
      success: true,
      deliveryBoy: deliveryBoy.getMaskedProfile(),
      canGoOnline: deliveryBoy.canGoOnline(),
      documentsVerified: deliveryBoy.areAllDocumentsVerified(),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update personal, vehicle, or bank details
 * PUT /api/delivery/auth/me
 */
export const updateDeliveryProfile = async (req, res, next) => {
  try {
    const deliveryBoy = await DeliveryBoy.findOne({ user: req.user._id });
    if (!deliveryBoy) {
      return next(new AppError("Delivery partner profile not found", 404));
    }

    const {
      fullName,
      currentAddress,
      serviceCity,
      serviceArea,
      emergencyContact,
      vehicleDetails,
      bankDetails,
      profilePhoto,
    } = req.body;

    if (fullName) deliveryBoy.fullName = fullName.trim();
    if (currentAddress) deliveryBoy.currentAddress = { ...deliveryBoy.currentAddress, ...currentAddress };
    if (serviceCity) deliveryBoy.serviceCity = serviceCity;
    if (serviceArea) deliveryBoy.serviceArea = serviceArea;
    if (emergencyContact) deliveryBoy.emergencyContact = { ...deliveryBoy.emergencyContact, ...emergencyContact };
    if (vehicleDetails) deliveryBoy.vehicleDetails = { ...deliveryBoy.vehicleDetails, ...vehicleDetails };
    if (bankDetails) deliveryBoy.bankDetails = { ...deliveryBoy.bankDetails, ...bankDetails };
    if (profilePhoto) deliveryBoy.profilePhoto = profilePhoto;

    await deliveryBoy.save();

    res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      deliveryBoy: deliveryBoy.getMaskedProfile(),
    });
  } catch (error) {
    next(error);
  }
};
