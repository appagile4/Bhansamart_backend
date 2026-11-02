import Address from "../models/Address.js";
import { AppError } from "../middleware/errorMiddleware.js";

/**
 * Helper to infer/ensure valid coordinates for an address
 */
export const resolveAddressCoords = (addrLine, city, lat, lng) => {
  if (lat != null && lng != null && !isNaN(Number(lat)) && !isNaN(Number(lng))) {
    return { latitude: Number(lat), longitude: Number(lng) };
  }
  const text = `${addrLine || ""} ${city || ""}`.toLowerCase();
  if (text.includes("dwarka") || text.includes("dawarka")) {
    return { latitude: 28.5921, longitude: 77.0460 };
  }
  if (text.includes("rohini")) {
    return { latitude: 28.7212, longitude: 77.1038 };
  }
  if (text.includes("meerut")) {
    return { latitude: 28.9845, longitude: 77.7064 };
  }
  if (text.includes("delhi") || text.includes("new delhi")) {
    return { latitude: 28.6139, longitude: 77.2090 };
  }
  if (text.includes("kathmandu")) {
    return { latitude: 27.7172, longitude: 85.3240 };
  }
  return { latitude: null, longitude: null };
};

/**
 * @desc    Get all addresses for logged in user
 * @route   GET /api/address
 * @access  Private
 */
export const getAddresses = async (req, res, next) => {
  try {
    const addresses = await Address.find({ user: req.user._id }).sort({
      isDefault: -1,
      createdAt: -1,
    });

    // Self-heal: ensure all saved addresses have coordinates populated
    for (const addr of addresses) {
      if (addr.latitude == null || addr.longitude == null) {
        const resolved = resolveAddressCoords(
          addr.addressLine,
          addr.city,
          addr.latitude,
          addr.longitude
        );
        if (resolved.latitude != null && resolved.longitude != null) {
          addr.latitude = resolved.latitude;
          addr.longitude = resolved.longitude;
          await addr.save();
        }
      }
    }

    res.status(200).json({
      success: true,
      count: addresses.length,
      data: addresses,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get single address by ID
 * @route   GET /api/address/:id
 * @access  Private
 */
export const getAddressById = async (req, res, next) => {
  try {
    const address = await Address.findOne({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!address) {
      return next(new AppError("Address not found", 404));
    }

    res.status(200).json({
      success: true,
      data: address,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Create new address
 * @route   POST /api/address
 * @access  Private
 */
export const createAddress = async (req, res, next) => {
  try {
    const {
      type,
      addressLine,
      houseNo,
      street,
      city,
      landmark,
      phone,
      isDefault,
      latitude,
      longitude,
    } = req.body;

    if (!addressLine && !houseNo) {
      return next(
        new AppError("Please provide an address line or house/building details", 400)
      );
    }

    if (!phone) {
      return next(new AppError("Please provide a phone number", 400));
    }

    const constructedAddressLine =
      addressLine ||
      [houseNo, landmark, street, city].filter(Boolean).join(", ");

    // If first address or isDefault is true, manage default status
    const existingCount = await Address.countDocuments({ user: req.user._id });
    const shouldBeDefault = isDefault || existingCount === 0;

    if (shouldBeDefault) {
      await Address.updateMany(
        { user: req.user._id },
        { $set: { isDefault: false } }
      );
    }

    const resolved = resolveAddressCoords(
      constructedAddressLine,
      city,
      latitude,
      longitude
    );

    const newAddress = await Address.create({
      user: req.user._id,
      type: type || "Home",
      addressLine: constructedAddressLine,
      houseNo: houseNo || "",
      street: street || "",
      city: city || "Kathmandu",
      landmark: landmark || "",
      phone: phone || req.user.phone || "",
      isDefault: shouldBeDefault,
      latitude: resolved.latitude,
      longitude: resolved.longitude,
    });

    res.status(201).json({
      success: true,
      message: "Address added successfully",
      data: newAddress,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update existing address
 * @route   PUT /api/address/:id
 * @access  Private
 */
export const updateAddress = async (req, res, next) => {
  try {
    const address = await Address.findOne({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!address) {
      return next(new AppError("Address not found", 404));
    }

    const {
      type,
      addressLine,
      houseNo,
      street,
      city,
      landmark,
      phone,
      isDefault,
      latitude,
      longitude,
    } = req.body;

    if (isDefault) {
      await Address.updateMany(
        { user: req.user._id, _id: { $ne: address._id } },
        { $set: { isDefault: false } }
      );
      address.isDefault = true;
    } else if (isDefault === false && address.isDefault) {
      address.isDefault = false;
    }

    if (type) address.type = type;
    if (houseNo !== undefined) address.houseNo = houseNo;
    if (street !== undefined) address.street = street;
    if (city !== undefined) address.city = city;
    if (landmark !== undefined) address.landmark = landmark;
    if (phone) address.phone = phone;
    if (latitude !== undefined) {
      address.latitude = latitude != null && !isNaN(Number(latitude)) ? Number(latitude) : null;
    }
    if (longitude !== undefined) {
      address.longitude = longitude != null && !isNaN(Number(longitude)) ? Number(longitude) : null;
    }

    if (addressLine) {
      address.addressLine = addressLine;
    } else if (houseNo || landmark || street || city) {
      address.addressLine = [
        address.houseNo,
        address.landmark,
        address.street,
        address.city,
      ]
        .filter(Boolean)
        .join(", ");
    }

    if (address.latitude == null || address.longitude == null) {
      const resolved = resolveAddressCoords(
        address.addressLine,
        address.city,
        address.latitude,
        address.longitude
      );
      if (resolved.latitude != null && resolved.longitude != null) {
        address.latitude = resolved.latitude;
        address.longitude = resolved.longitude;
      }
    }

    await address.save();

    res.status(200).json({
      success: true,
      message: "Address updated successfully",
      data: address,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Delete address
 * @route   DELETE /api/address/:id
 * @access  Private
 */
export const deleteAddress = async (req, res, next) => {
  try {
    const address = await Address.findOneAndDelete({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!address) {
      return next(new AppError("Address not found", 404));
    }

    // If deleted address was default, set another address as default if exists
    if (address.isDefault) {
      const anotherAddress = await Address.findOne({ user: req.user._id }).sort({
        createdAt: -1,
      });
      if (anotherAddress) {
        anotherAddress.isDefault = true;
        await anotherAddress.save();
      }
    }

    res.status(200).json({
      success: true,
      message: "Address deleted successfully",
      deletedId: req.params.id,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Set address as default
 * @route   PATCH /api/address/:id/default
 * @access  Private
 */
export const setDefaultAddress = async (req, res, next) => {
  try {
    const targetAddress = await Address.findOne({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!targetAddress) {
      return next(new AppError("Address not found", 404));
    }

    await Address.updateMany(
      { user: req.user._id },
      { $set: { isDefault: false } }
    );

    targetAddress.isDefault = true;
    await targetAddress.save();

    const allAddresses = await Address.find({ user: req.user._id }).sort({
      isDefault: -1,
      createdAt: -1,
    });

    res.status(200).json({
      success: true,
      message: "Default address updated",
      data: allAddresses,
    });
  } catch (error) {
    next(error);
  }
};
