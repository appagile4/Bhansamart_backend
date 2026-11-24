import { Router } from "express";
import { getCategories, getCategoryBySlug } from "../controllers/categoryController.js";

const router = Router();

router.get("/", getCategories);
router.get("/:slugOrId", getCategoryBySlug);

export default router;
