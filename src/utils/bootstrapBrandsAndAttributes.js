import Brand from "../models/Brand.js";
import Attribute from "../models/Attribute.js";

const DEFAULT_BRANDS = [
  {
    name: "Amul",
    slug: "amul",
    categories: ["Grocery & Kitchen", "Snacks & Drinks"],
    logo: "https://logo.clearbit.com/amul.com",
    description: "The Taste of India - Dairy products and snacks",
    status: "APPROVED",
    isGlobal: true,
  },
  {
    name: "Nestle",
    slug: "nestle",
    categories: ["Grocery & Kitchen", "Snacks & Drinks", "Baby"],
    logo: "https://logo.clearbit.com/nestle.com",
    description: "Good food, Good life - Nutrition, health and wellness",
    status: "APPROVED",
    isGlobal: true,
  },
  {
    name: "Tata Sampann",
    slug: "tata-sampann",
    categories: ["Grocery & Kitchen"],
    logo: "https://logo.clearbit.com/tataconsumer.com",
    description: "Wholesome natural food products by Tata",
    status: "APPROVED",
    isGlobal: true,
  },
  {
    name: "Dabur",
    slug: "dabur",
    categories: ["Grocery & Kitchen", "Beauty & Personal Care"],
    logo: "https://logo.clearbit.com/dabur.com",
    description: "Science-based Ayurvedic healthcare and beauty",
    status: "APPROVED",
    isGlobal: true,
  },
  {
    name: "Everest",
    slug: "everest",
    categories: ["Grocery & Kitchen"],
    logo: "https://logo.clearbit.com/everestspices.com",
    description: "India's leading spice manufacturer",
    status: "APPROVED",
    isGlobal: true,
  },
  {
    name: "Fortune",
    slug: "fortune",
    categories: ["Grocery & Kitchen"],
    logo: "https://logo.clearbit.com/fortunefoods.com",
    description: "Cooking oils, basmati rice, atta, and soya chunks",
    status: "APPROVED",
    isGlobal: true,
  },
  {
    name: "Aashirvaad",
    slug: "aashirvaad",
    categories: ["Grocery & Kitchen"],
    logo: "https://logo.clearbit.com/itcportal.com",
    description: "Whole wheat atta and staples",
    status: "APPROVED",
    isGlobal: true,
  },
  {
    name: "Lay's",
    slug: "lays",
    categories: ["Snacks & Drinks"],
    logo: "https://logo.clearbit.com/lays.com",
    description: "Crispy potato chips in diverse delicious flavors",
    status: "APPROVED",
    isGlobal: true,
  },
  {
    name: "Haldiram's",
    slug: "haldirams",
    categories: ["Snacks & Drinks"],
    logo: "https://logo.clearbit.com/haldirams.com",
    description: "Traditional Indian sweets and savories",
    status: "APPROVED",
    isGlobal: true,
  },
  {
    name: "Cadbury",
    slug: "cadbury",
    categories: ["Snacks & Drinks", "Gifting"],
    logo: "https://logo.clearbit.com/cadbury.co.uk",
    description: "Iconic chocolates and confectionery",
    status: "APPROVED",
    isGlobal: true,
  },
  {
    name: "Coca-Cola",
    slug: "coca-cola",
    categories: ["Snacks & Drinks"],
    logo: "https://logo.clearbit.com/coca-cola.com",
    description: "Refreshing sparkling beverages",
    status: "APPROVED",
    isGlobal: true,
  },
  {
    name: "Pepsi",
    slug: "pepsi",
    categories: ["Snacks & Drinks"],
    logo: "https://logo.clearbit.com/pepsi.com",
    description: "Cold drinks and refreshments",
    status: "APPROVED",
    isGlobal: true,
  },
  {
    name: "Nivea",
    slug: "nivea",
    categories: ["Beauty & Personal Care"],
    logo: "https://logo.clearbit.com/nivea.com",
    description: "Skincare, body lotions and personal care",
    status: "APPROVED",
    isGlobal: true,
  },
  {
    name: "L'Oreal",
    slug: "loreal",
    categories: ["Beauty & Personal Care"],
    logo: "https://logo.clearbit.com/loreal.com",
    description: "Hair care, skin care and beauty products",
    status: "APPROVED",
    isGlobal: true,
  },
  {
    name: "Himalaya",
    slug: "himalaya",
    categories: ["Beauty & Personal Care", "Baby"],
    logo: "https://logo.clearbit.com/himalayawellness.com",
    description: "Herbal personal care and baby wellness",
    status: "APPROVED",
    isGlobal: true,
  },
  {
    name: "Dettol",
    slug: "dettol",
    categories: ["Beauty & Personal Care"],
    logo: "https://logo.clearbit.com/dettol.co.uk",
    description: "Antiseptic liquids, soaps and sanitization",
    status: "APPROVED",
    isGlobal: true,
  },
  {
    name: "Pampers",
    slug: "pampers",
    categories: ["Baby"],
    logo: "https://logo.clearbit.com/pampers.com",
    description: "Baby diapers and wipes",
    status: "APPROVED",
    isGlobal: true,
  },
  {
    name: "Johnson's Baby",
    slug: "johnsons-baby",
    categories: ["Baby"],
    logo: "https://logo.clearbit.com/johnsonsbaby.com",
    description: "Gentle baby skin and bath essentials",
    status: "APPROVED",
    isGlobal: true,
  },
  {
    name: "Classmate",
    slug: "classmate",
    categories: ["School, Office & Stationery"],
    logo: "https://logo.clearbit.com/classmateshop.com",
    description: "Notebooks, pens and school stationery",
    status: "APPROVED",
    isGlobal: true,
  },
  {
    name: "Camlin",
    slug: "camlin",
    categories: ["School, Office & Stationery"],
    logo: "https://logo.clearbit.com/kokuyocamlin.com",
    description: "Pencils, geometry boxes, and colors",
    status: "APPROVED",
    isGlobal: true,
  },
  {
    name: "Faber-Castell",
    slug: "faber-castell",
    categories: ["School, Office & Stationery"],
    logo: "https://logo.clearbit.com/faber-castell.com",
    description: "Art supplies, highlighters and markers",
    status: "APPROVED",
    isGlobal: true,
  },
  {
    name: "Generic / Store Brand",
    slug: "generic-store-brand",
    categories: [
      "Grocery & Kitchen",
      "Snacks & Drinks",
      "Beauty & Personal Care",
      "School, Office & Stationery",
      "Baby",
      "Gifting",
    ],
    logo: "",
    description: "Unbranded or store-packaged everyday items",
    status: "APPROVED",
    isGlobal: true,
  },
];

const DEFAULT_ATTRIBUTES = [
  {
    name: "Weight / Pack Size",
    slug: "weight-pack-size",
    categories: ["Grocery & Kitchen", "Snacks & Drinks"],
    values: ["50g", "100g", "200g", "250g", "500g", "1 kg", "2 kg", "5 kg", "10 kg"],
    type: "single",
    status: "ACTIVE",
    isGlobal: true,
  },
  {
    name: "Volume",
    slug: "volume",
    categories: ["Snacks & Drinks", "Beauty & Personal Care"],
    values: ["100 ml", "200 ml", "250 ml", "500 ml", "750 ml", "1 L", "2 L"],
    type: "single",
    status: "ACTIVE",
    isGlobal: true,
  },
  {
    name: "Color",
    slug: "color",
    categories: ["School, Office & Stationery", "Gifting", "Baby"],
    values: ["Red", "Blue", "Black", "Green", "White", "Yellow", "Pink", "Silver", "Gold", "Assorted"],
    type: "single",
    status: "ACTIVE",
    isGlobal: true,
  },
  {
    name: "Size",
    slug: "size",
    categories: ["Gifting", "Baby"],
    values: ["Small", "Medium", "Large", "XL", "XXL", "Newborn (0-3M)", "3-6M", "6-12M"],
    type: "single",
    status: "ACTIVE",
    isGlobal: true,
  },
  {
    name: "Flavor",
    slug: "flavor",
    categories: ["Snacks & Drinks"],
    values: ["Classic Salted", "Masala Magic", "Cream & Onion", "Chocolate", "Vanilla", "Strawberry", "Mango", "Mint"],
    type: "single",
    status: "ACTIVE",
    isGlobal: true,
  },
];

export async function bootstrapBrandsAndAttributes() {
  try {
    const brandCount = await Brand.countDocuments();
    if (brandCount === 0) {
      console.log("[Bootstrap] Seeding initial approved brands...");
      await Brand.insertMany(DEFAULT_BRANDS);
      console.log(`[Bootstrap] Successfully seeded ${DEFAULT_BRANDS.length} default brands.`);
    }

    const attributeCount = await Attribute.countDocuments();
    if (attributeCount === 0) {
      console.log("[Bootstrap] Seeding initial attributes...");
      await Attribute.insertMany(DEFAULT_ATTRIBUTES);
      console.log(`[Bootstrap] Successfully seeded ${DEFAULT_ATTRIBUTES.length} default attributes.`);
    }
  } catch (err) {
    console.warn("[Bootstrap] Non-fatal error bootstrapping brands/attributes:", err.message);
  }
}
