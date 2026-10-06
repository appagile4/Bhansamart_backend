import User from "../models/User.js";
import Vendor from "../models/Vendor.js";
import { generateNumericOTP } from "../utils/generateOTP.js";
import { generateTokenAndSetCookie } from "../utils/generateToken.js";
import { sendVendorOTP } from "../utils/sendEmail.js";

/**
 * @desc    Register a new Vendor
 * @route   POST /api/auth/vendor/register
 * @access  Public
 */
export const registerVendor = async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      phone,
      storeName,
      address,
      city,
      state,
      pincode,
      category,
    } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Name, email, and password are required.",
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check if user already exists
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      if (existingUser.role === "customer" || existingUser.role === "user") {
        return res.status(409).json({
          success: false,
          message:
            "This email is already registered as a Customer account. One email can only be used for either Customer or Vendor.",
        });
      }
      return res.status(409).json({
        success: false,
        message: "A vendor account with this email already exists. Please log in.",
      });
    }

    // Create Vendor User
    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      password,
      phone: phone ? phone.trim() : "",
      address: address ? address.trim() : "",
      role: "vendor",
      status: "active",
      isApproved: true,
      isEmailVerified: true,
    });

    // Create associated Vendor Profile
    const vendorProfile = await Vendor.create({
      userId: user._id,
      businessDetails: {
        businessName: storeName ? storeName.trim() : `${name.trim()}'s Store`,
        businessEmail: normalizedEmail,
        businessPhone: phone ? phone.trim() : "",
        categories: category ? [category] : ["Grocery"],
      },
      sellerDetails: {
        sellerName: name.trim(),
        sellerEmail: normalizedEmail,
        sellerPhone: phone ? phone.trim() : "",
        address: address ? address.trim() : "",
        city: city ? city.trim() : "",
        state: state ? state.trim() : "",
        pincode: pincode ? pincode.trim() : "",
      },
      status: "active",
    });

    // Generate token
    const token = generateTokenAndSetCookie(res, user._id, "vendor");

    return res.status(201).json({
      success: true,
      message: "Vendor account created successfully. Welcome to BhansaMart SellerHub!",
      token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        avatar: user.avatar,
        status: user.status,
      },
      vendor: vendorProfile,
    });
  } catch (error) {
    console.error("[Vendor Register Error]:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to register vendor.",
    });
  }
};

/**
 * @desc    Vendor Login with Email & Password
 * @route   POST /api/auth/vendor/login
 * @access  Public
 */
export const loginVendorWithPassword = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required.",
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Find user with password
    const user = await User.findOne({ email: normalizedEmail }).select("+password");

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    // Role verification: One email is either customer or vendor
    if (user.role === "customer" || user.role === "user") {
      return res.status(403).json({
        success: false,
        message:
          "This email is registered as a Customer account. Please log in through the Customer App.",
      });
    }

    if (user.role !== "vendor" && user.role !== "admin" && user.role !== "superadmin") {
      return res.status(403).json({
        success: false,
        message: "Access denied. This account does not have vendor privileges.",
      });
    }

    // Verify password
    const isPasswordMatch = await user.comparePassword(password);
    if (!isPasswordMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    // Account status check
    if (user.status === "suspended") {
      return res.status(403).json({
        success: false,
        message: "Your vendor account is suspended. Please contact BhansaMart support.",
      });
    }

    // Fetch vendor details
    let vendorProfile = await Vendor.findOne({ userId: user._id });
    if (!vendorProfile) {
      vendorProfile = await Vendor.create({
        userId: user._id,
        businessDetails: {
          businessName: `${user.name}'s Store`,
          businessEmail: user.email,
        },
        sellerDetails: {
          sellerName: user.name,
          sellerEmail: user.email,
        },
      });
    }

    // Update last login
    user.lastLoginAt = new Date();
    await user.save({ validateBeforeSave: false });

    // Generate JWT token
    const token = generateTokenAndSetCookie(res, user._id, "vendor");

    return res.status(200).json({
      success: true,
      message: "Vendor login successful.",
      token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        avatar: user.avatar,
        status: user.status,
      },
      vendor: vendorProfile,
    });
  } catch (error) {
    console.error("[Vendor Password Login Error]:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to log in.",
    });
  }
};

/**
 * @desc    Send OTP for Vendor Login
 * @route   POST /api/auth/vendor/send-otp
 * @access  Public
 */
export const requestVendorOTP = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email address is required.",
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "No vendor account found with this email. Please register first.",
      });
    }

    // Role check
    if (user.role === "customer" || user.role === "user") {
      return res.status(403).json({
        success: false,
        message:
          "This email belongs to a Customer account. Please log in via the Customer App.",
      });
    }

    if (user.role !== "vendor" && user.role !== "admin" && user.role !== "superadmin") {
      return res.status(403).json({
        success: false,
        message: "This account does not have vendor access.",
      });
    }

    // Generate 6-digit OTP
    const otp = generateNumericOTP(6);
    user.otp = otp;
    user.otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes expiry
    await user.save({ validateBeforeSave: false });

    // Send email
    await sendVendorOTP(normalizedEmail, otp);

    return res.status(200).json({
      success: true,
      message: `OTP code sent successfully to ${normalizedEmail}.`,
    });
  } catch (error) {
    console.error("[Request Vendor OTP Error]:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to send OTP.",
    });
  }
};

/**
 * @desc    Verify OTP & Log in Vendor
 * @route   POST /api/auth/vendor/verify-otp
 * @access  Public
 */
export const verifyVendorOTPLogin = async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: "Email and 6-digit OTP are required.",
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const user = await User.findOne({ email: normalizedEmail }).select("+otp +otpExpires");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Vendor account not found.",
      });
    }

    if (user.role === "customer" || user.role === "user") {
      return res.status(403).json({
        success: false,
        message: "This account is a Customer account. Please use the Customer App.",
      });
    }

    if (!user.otp || user.otp !== otp.toString().trim()) {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP code. Please enter the correct code.",
      });
    }

    if (!user.otpExpires || user.otpExpires.getTime() < Date.now()) {
      return res.status(400).json({
        success: false,
        message: "OTP has expired. Please request a new one.",
      });
    }

    // Clear OTP fields
    user.otp = undefined;
    user.otpExpires = undefined;
    user.lastLoginAt = new Date();
    await user.save({ validateBeforeSave: false });

    // Fetch vendor details
    let vendorProfile = await Vendor.findOne({ userId: user._id });
    if (!vendorProfile) {
      vendorProfile = await Vendor.create({
        userId: user._id,
        businessDetails: {
          businessName: `${user.name}'s Store`,
          businessEmail: user.email,
        },
      });
    }

    // Generate JWT token
    const token = generateTokenAndSetCookie(res, user._id, "vendor");

    return res.status(200).json({
      success: true,
      message: "Vendor OTP verified successfully. Welcome back!",
      token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        avatar: user.avatar,
        status: user.status,
      },
      vendor: vendorProfile,
    });
  } catch (error) {
    console.error("[Verify Vendor OTP Error]:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to verify OTP.",
    });
  }
};

/**
 * @desc    Get Current Vendor Profile
 * @route   GET /api/auth/vendor/me
 * @access  Private (Vendor)
 */
export const getMyVendorProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const vendor = await Vendor.findOne({ userId: req.user._id });

    return res.status(200).json({
      success: true,
      user,
      vendor,
    });
  } catch (error) {
    console.error("[Get Vendor Profile Error]:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};
