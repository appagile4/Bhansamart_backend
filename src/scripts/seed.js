import dotenv from "dotenv";
import mongoose from "mongoose";
import User from "../models/User.js";
import Vendor from "../models/Vendor.js";
import Product from "../models/Product.js";

dotenv.config();

const MONGO_URI =
  process.env.MONGO_URI ||
  "mongodb+srv://testUser:devilkumar123@cluster0.ogsfrpj.mongodb.net/BhansaMart_backend";

const SEED_DATA = [
  // ─────────────────────────────────────────────────────────────────────────────
  // 1. GROCERY & KITCHEN (8 Subcategories × 2 Products = 16 Products)
  // ─────────────────────────────────────────────────────────────────────────────
  {
    category: "Grocery & Kitchen",
    subCategory: "Vegetables & Fruits",
    items: [
      {
        name: "Fresh Farm Hybrid Tomatoes",
        price: 75,
        originalPrice: 90,
        unit: "1 kg",
        stock: 150,
        brand: "Farm Fresh",
        description: "Plump, red, and juicy farm-fresh hybrid tomatoes perfect for daily curries, salads, and cooking.",
        image: "https://images.unsplash.com/photo-1592924357228-91a4daadcfea?w=800&auto=format&fit=crop&q=80",
        tags: ["Vegetables", "Fresh", "Farm", "Tomatoes"],
      },
      {
        name: "Premium Royal Delicious Apples",
        price: 240,
        originalPrice: 280,
        unit: "1 kg",
        stock: 80,
        brand: "Himalayan Gold",
        description: "Crisp and naturally sweet Himalayan Royal Delicious apples rich in dietary fiber and vitamins.",
        image: "https://images.unsplash.com/photo-1560806887-1e4cd0b6cbd6?w=800&auto=format&fit=crop&q=80",
        tags: ["Fruits", "Apples", "Organic", "Fresh"],
      },
    ],
  },
  {
    category: "Grocery & Kitchen",
    subCategory: "Atta, Rice & Dal",
    items: [
      {
        name: "Premium Sharbati Whole Wheat Atta",
        price: 450,
        originalPrice: 500,
        unit: "5 kg Bag",
        stock: 120,
        brand: "Annapurna",
        description: "100% MP Sharbati whole wheat flour milled to perfection for extra soft and fluffy rotis.",
        image: "https://images.unsplash.com/photo-1509440159596-0249088772ff?w=800&auto=format&fit=crop&q=80",
        tags: ["Atta", "Flour", "Wheat", "Staples"],
      },
      {
        name: "Traditional Yellow Moong Dal",
        price: 180,
        originalPrice: 200,
        unit: "1 kg Pack",
        stock: 95,
        brand: "Annapurna",
        description: "Unpolished, protein-rich yellow moong dal split without skin. Highly digestible and healthy.",
        image: "https://images.unsplash.com/photo-1586201375761-83865001e31c?w=800&auto=format&fit=crop&q=80",
        tags: ["Dal", "Pulses", "Protein", "Moong"],
      },
    ],
  },
  {
    category: "Grocery & Kitchen",
    subCategory: "Oil, Ghee & Masala",
    items: [
      {
        name: "Pure Desi Cow Ghee Golden Aroma",
        price: 950,
        originalPrice: 1100,
        unit: "1 Litre Jar",
        stock: 60,
        brand: "Himalayan Gold",
        description: "Traditional bilona churned pure cow ghee with rich granular texture and mouthwatering aroma.",
        image: "https://images.unsplash.com/photo-1628088062854-d1870b4553da?w=800&auto=format&fit=crop&q=80",
        tags: ["Ghee", "Dairy", "Pure", "Desi"],
      },
      {
        name: "Cold Pressed Mustard Oil Kachi Ghani",
        price: 260,
        originalPrice: 290,
        unit: "1 Litre Bottle",
        stock: 110,
        brand: "Dhara Pure",
        description: "Pungent and authentic cold-pressed mustard oil with natural antioxidants and bold flavor.",
        image: "https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=800&auto=format&fit=crop&q=80",
        tags: ["Oil", "Mustard", "Cooking", "Kachi Ghani"],
      },
    ],
  },
  {
    category: "Grocery & Kitchen",
    subCategory: "Dairy, Bread & Eggs",
    items: [
      {
        name: "Farm Fresh Full Cream Milk",
        price: 80,
        originalPrice: 90,
        unit: "1 Litre Pouch",
        stock: 200,
        brand: "Bhansa Mart Choice",
        description: "Pasteurized, homogenized full-cream fresh milk sourced directly from local dairy cooperatives.",
        image: "https://images.unsplash.com/photo-1550583724-b2692b85b150?w=800&auto=format&fit=crop&q=80",
        tags: ["Milk", "Dairy", "Fresh", "Calcium"],
      },
      {
        name: "100% Whole Wheat Brown Bread",
        price: 65,
        originalPrice: 75,
        unit: "400 g Loaf",
        stock: 75,
        brand: "Bhansa Mart Choice",
        description: "Healthy and high-fiber whole grain brown bread baked fresh every morning with no added preservatives.",
        image: "https://images.unsplash.com/photo-1509440159596-0249088772ff?w=800&auto=format&fit=crop&q=80",
        tags: ["Bread", "Bakery", "Whole Wheat", "Breakfast"],
      },
    ],
  },
  {
    category: "Grocery & Kitchen",
    subCategory: "Bakery & Biscuits",
    items: [
      {
        name: "Butter Cashew Delight Cookies",
        price: 135,
        originalPrice: 150,
        unit: "300 g Box",
        stock: 90,
        brand: "Annapurna",
        description: "Crunchy oven-baked cookies loaded with rich creamy butter and roasted cashew chunks.",
        image: "https://images.unsplash.com/photo-1558961363-fa8fdf82db35?w=800&auto=format&fit=crop&q=80",
        tags: ["Cookies", "Bakery", "Butter", "Biscuits"],
      },
      {
        name: "Crispy Multigrain Toast Rusk",
        price: 90,
        originalPrice: 105,
        unit: "250 g Pack",
        stock: 120,
        brand: "Annapurna",
        description: "Double baked crispy multigrain rusks infused with aromatic fennel and cardamom seeds.",
        image: "https://images.unsplash.com/photo-1549931319-a545dcf3bc73?w=800&auto=format&fit=crop&q=80",
        tags: ["Rusk", "Toast", "Tea Time", "Bakery"],
      },
    ],
  },
  {
    category: "Grocery & Kitchen",
    subCategory: "Dry Fruits & Cereals",
    items: [
      {
        name: "California Jumbo Almonds (Badam)",
        price: 520,
        originalPrice: 600,
        unit: "500 g Pack",
        stock: 65,
        brand: "Organic Valley",
        description: "Hand-picked, nutrient dense premium California whole raw almonds packed in airtight pouch.",
        image: "https://images.unsplash.com/photo-1508061253366-f7da158b6d46?w=800&auto=format&fit=crop&q=80",
        tags: ["Almonds", "Dry Fruits", "Badam", "Healthy"],
      },
      {
        name: "Crunchy Honey Almond Corn Flakes",
        price: 340,
        originalPrice: 380,
        unit: "450 g Box",
        stock: 85,
        brand: "Organic Valley",
        description: "Golden toasted corn flakes enriched with real organic honey and crunchy almond slices.",
        image: "https://images.unsplash.com/photo-1521483451569-e33803c0330c?w=800&auto=format&fit=crop&q=80",
        tags: ["Cereals", "Breakfast", "Corn Flakes", "Honey"],
      },
    ],
  },
  {
    category: "Grocery & Kitchen",
    subCategory: "Chicken, Meat & Fish",
    items: [
      {
        name: "Fresh Boneless Chicken Breast",
        price: 380,
        originalPrice: 420,
        unit: "500 g Tray",
        stock: 45,
        brand: "Farm Fresh",
        description: "Tender, hygienic, antibiotic-free chicken breast fillets cleaned and vacuum sealed.",
        image: "https://images.unsplash.com/photo-1604503468506-a8da13d82791?w=800&auto=format&fit=crop&q=80",
        tags: ["Chicken", "Meat", "Protein", "Fresh"],
      },
      {
        name: "Fresh River Rohu Fish Steaks",
        price: 490,
        originalPrice: 550,
        unit: "1 kg Pack",
        stock: 30,
        brand: "Farm Fresh",
        description: "Daily caught fresh river Rohu fish, scaled, gutted, and cut into neat curry cut pieces.",
        image: "https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?w=800&auto=format&fit=crop&q=80",
        tags: ["Fish", "Seafood", "Fresh", "Curry Cut"],
      },
    ],
  },
  {
    category: "Grocery & Kitchen",
    subCategory: "Kitchenware & Appliances",
    items: [
      {
        name: "Granite Non-Stick Frying Pan (24cm)",
        price: 1250,
        originalPrice: 1500,
        unit: "1 Unit",
        stock: 40,
        brand: "Bhansa Mart Choice",
        description: "Heavy gauge 5-layer granite coating non-stick skillet with heat-resistant ergonomic handle.",
        image: "https://images.unsplash.com/photo-1584269600519-112d071b35e6?w=800&auto=format&fit=crop&q=80",
        tags: ["Cookware", "Kitchenware", "Non Stick", "Pan"],
      },
      {
        name: "Stainless Steel Insulated Water Bottle (750ml)",
        price: 650,
        originalPrice: 800,
        unit: "1 Piece",
        stock: 70,
        brand: "Bhansa Mart Choice",
        description: "Double wall vacuum insulation keeps beverages cold for 24 hours or hot for 12 hours.",
        image: "https://images.unsplash.com/photo-1602143407151-7111542de6e8?w=800&auto=format&fit=crop&q=80",
        tags: ["Bottle", "Steel", "Kitchen", "Flask"],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. SNACKS & DRINKS (8 Subcategories × 2 Products = 16 Products)
  // ─────────────────────────────────────────────────────────────────────────────
  {
    category: "Snacks & Drinks",
    subCategory: "Chips & Namkeen",
    items: [
      {
        name: "Classic Salted Crispy Potato Chips",
        price: 50,
        originalPrice: 60,
        unit: "120 g Bag",
        stock: 140,
        brand: "Bhansa Mart Choice",
        description: "Thin cut golden potato wafers seasoned with mountain rock salt for an irresistible crunch.",
        image: "https://images.unsplash.com/photo-1566478989037-eec170784d0b?w=800&auto=format&fit=crop&q=80",
        tags: ["Chips", "Snacks", "Potato", "Crispy"],
      },
      {
        name: "Authentic Bikaneri Bhujia Sev",
        price: 140,
        originalPrice: 160,
        unit: "400 g Pack",
        stock: 110,
        brand: "Bhansa Mart Choice",
        description: "Crispy, spiced moth bean and besan flour sev seasoned with black pepper, cloves, and cardamom.",
        image: "https://images.unsplash.com/photo-1601050690597-df0568f70950?w=800&auto=format&fit=crop&q=80",
        tags: ["Namkeen", "Bhujia", "Snacks", "Traditional"],
      },
    ],
  },
  {
    category: "Snacks & Drinks",
    subCategory: "Sweets & Chocolates",
    items: [
      {
        name: "Pure Desi Ghee Kaju Katli",
        price: 480,
        originalPrice: 550,
        unit: "250 g Box",
        stock: 50,
        brand: "Himalayan Gold",
        description: "Melt-in-mouth traditional Indian sweet crafted from premium Goan cashews and pure ghee.",
        image: "https://images.unsplash.com/photo-1599785209707-a456fc1337bb?w=800&auto=format&fit=crop&q=80",
        tags: ["Sweets", "Kaju Katli", "Mithai", "Dessert"],
      },
      {
        name: "Artisanal Dark Chocolate 70% Cocoa",
        price: 190,
        originalPrice: 220,
        unit: "100 g Bar",
        stock: 75,
        brand: "Organic Valley",
        description: "Single origin bean-to-bar dark chocolate infused with real vanilla bean extract.",
        image: "https://images.unsplash.com/photo-1549007994-cb92caebd54b?w=800&auto=format&fit=crop&q=80",
        tags: ["Chocolate", "Dark Chocolate", "Sweets", "Cocoa"],
      },
    ],
  },
  {
    category: "Snacks & Drinks",
    subCategory: "Drinks & Juices",
    items: [
      {
        name: "100% Pure Valencia Orange Juice",
        price: 180,
        originalPrice: 210,
        unit: "1 Litre Carton",
        stock: 95,
        brand: "Organic Valley",
        description: "Pressed from sunny Valencia oranges with no added sugar, artificial flavors, or concentrate.",
        image: "https://images.unsplash.com/photo-1613478223719-2ab802602423?w=800&auto=format&fit=crop&q=80",
        tags: ["Juice", "Orange", "Beverages", "Vitamin C"],
      },
      {
        name: "Sparkling Lemon Mint Mocktail",
        price: 95,
        originalPrice: 110,
        unit: "330 ml Can",
        stock: 130,
        brand: "Bhansa Mart Choice",
        description: "Refreshing fizzy mocktail blended with natural lemon juice and cool peppermint extracts.",
        image: "https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?w=800&auto=format&fit=crop&q=80",
        tags: ["Drinks", "Soda", "Mint", "Lemonade"],
      },
    ],
  },
  {
    category: "Snacks & Drinks",
    subCategory: "Tea, Coffee & Milk Drinks",
    items: [
      {
        name: "Organic Himalayan CTC Leaf Tea",
        price: 280,
        originalPrice: 320,
        unit: "500 g Pack",
        stock: 105,
        brand: "Himalayan Gold",
        description: "Strong, aromatic, and deep amber liquor CTC black tea handpicked from high altitude tea gardens.",
        image: "https://images.unsplash.com/photo-1576092768241-dec231879fc3?w=800&auto=format&fit=crop&q=80",
        tags: ["Tea", "Chai", "Beverage", "Himalayan"],
      },
      {
        name: "Roasted Arabica Coffee Beans",
        price: 520,
        originalPrice: 600,
        unit: "250 g Pouch",
        stock: 60,
        brand: "Organic Valley",
        description: "Medium-dark roasted premium Arabica whole coffee beans featuring notes of dark cocoa and hazelnut.",
        image: "https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=800&auto=format&fit=crop&q=80",
        tags: ["Coffee", "Arabica", "Beans", "Espresso"],
      },
    ],
  },
  {
    category: "Snacks & Drinks",
    subCategory: "Instant Food",
    items: [
      {
        name: "Spicy Schezwan Instant Noodles",
        price: 90,
        originalPrice: 105,
        unit: "Pack of 4",
        stock: 160,
        brand: "Bhansa Mart Choice",
        description: "Springy noodles infused with hot and tangy Schezwan seasoning for an instant spicy treat in 3 minutes.",
        image: "https://images.unsplash.com/photo-1612927601601-6638404737ce?w=800&auto=format&fit=crop&q=80",
        tags: ["Noodles", "Instant Food", "Spicy", "Quick Meal"],
      },
      {
        name: "Ready-To-Eat Sweet Corn Soup Mix",
        price: 65,
        originalPrice: 75,
        unit: "4 Servings (80g)",
        stock: 120,
        brand: "Annapurna",
        description: "Classic creamy sweet corn soup with real tender corn kernels and wholesome vegetable seasonings.",
        image: "https://images.unsplash.com/photo-1547592166-23ac45744acd?w=800&auto=format&fit=crop&q=80",
        tags: ["Soup", "Instant", "Corn", "Healthy"],
      },
    ],
  },
  {
    category: "Snacks & Drinks",
    subCategory: "Sauce & Spreads",
    items: [
      {
        name: "All-Natural Crunchy Peanut Butter",
        price: 340,
        originalPrice: 390,
        unit: "500 g Jar",
        stock: 80,
        brand: "Organic Valley",
        description: "100% roasted peanuts with zero added sugar, hydrogenated oils, or artificial emulsifiers.",
        image: "https://images.unsplash.com/photo-1589733955941-5eeaf752f6dd?w=800&auto=format&fit=crop&q=80",
        tags: ["Peanut Butter", "Spreads", "Protein", "Fitness"],
      },
      {
        name: "Classic Italian Tomato Basil Pasta Sauce",
        price: 240,
        originalPrice: 280,
        unit: "350 g Bottle",
        stock: 70,
        brand: "Organic Valley",
        description: "Slow-simmered vine-ripened Italian plum tomatoes blended with extra virgin olive oil and fresh basil.",
        image: "https://images.unsplash.com/photo-1608897013039-887f21d8c804?w=800&auto=format&fit=crop&q=80",
        tags: ["Sauce", "Pasta", "Tomato", "Italian"],
      },
    ],
  },
  {
    category: "Snacks & Drinks",
    subCategory: "Paan Corner",
    items: [
      {
        name: "Royal Meetha Paan Gulkand Mukhwas",
        price: 110,
        originalPrice: 130,
        unit: "150 g Jar",
        stock: 90,
        brand: "Bhansa Mart Choice",
        description: "Refreshing mouth freshener prepared from real Calcutta betel leaves, rose gulkand, and fennel.",
        image: "https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=800&auto=format&fit=crop&q=80",
        tags: ["Paan", "Mukhwas", "Digestive", "Mouth Freshener"],
      },
      {
        name: "Cool Spearmint Breath Pearls",
        price: 60,
        originalPrice: 70,
        unit: "50 g Dispenser",
        stock: 150,
        brand: "Bhansa Mart Choice",
        description: "Pocket-sized sugar-free breath mints offering instant icy cool freshness all day long.",
        image: "https://images.unsplash.com/photo-1582293041079-7814c2f12063?w=800&auto=format&fit=crop&q=80",
        tags: ["Mint", "Candy", "Fresh Breath", "Snacks"],
      },
    ],
  },
  {
    category: "Snacks & Drinks",
    subCategory: "Ice Cream & More",
    items: [
      {
        name: "Alphonso Royal Mango Ice Cream Tub",
        price: 320,
        originalPrice: 360,
        unit: "700 ml Tub",
        stock: 55,
        brand: "Himalayan Gold",
        description: "Creamy premium dairy ice cream made with real Ratnagiri Alphonso mango pulp and milk cream.",
        image: "https://images.unsplash.com/photo-1560008581-09826d1de69e?w=800&auto=format&fit=crop&q=80",
        tags: ["Ice Cream", "Mango", "Dessert", "Frozen"],
      },
      {
        name: "Belgian Dark Chocolate Truffle Ice Cream",
        price: 350,
        originalPrice: 400,
        unit: "700 ml Tub",
        stock: 45,
        brand: "Himalayan Gold",
        description: "Indulgent Belgian chocolate ice cream swirled with gooey dark chocolate fudge and brownie bits.",
        image: "https://images.unsplash.com/photo-1570197788417-0e82375c9371?w=800&auto=format&fit=crop&q=80",
        tags: ["Ice Cream", "Chocolate", "Truffle", "Dessert"],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. BEAUTY & PERSONAL CARE (8 Subcategories × 2 Products = 16 Products)
  // ─────────────────────────────────────────────────────────────────────────────
  {
    category: "Beauty & Personal Care",
    subCategory: "Bath & Body",
    items: [
      {
        name: "Refreshing Sea Minerals Hydrating Body Wash",
        price: 290,
        originalPrice: 340,
        unit: "300 ml Bottle",
        stock: 85,
        brand: "Himalaya Pure",
        description: "Deep cleansing shower gel enriched with natural sea minerals and essential ocean botanicals.",
        image: "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=800&auto=format&fit=crop&q=80",
        tags: ["Body Wash", "Bath", "Skincare", "Shower"],
      },
      {
        name: "Pure Neem & Turmeric Ayurvedic Soap",
        price: 150,
        originalPrice: 180,
        unit: "Pack of 3 (125g each)",
        stock: 110,
        brand: "Himalaya Pure",
        description: "Gentle antimicrobial bathing bar that purifies, soothes, and protects sensitive skin.",
        image: "https://images.unsplash.com/photo-1607006314144-8459f0f9b6b7?w=800&auto=format&fit=crop&q=80",
        tags: ["Soap", "Ayurvedic", "Neem", "Herbal"],
      },
    ],
  },
  {
    category: "Beauty & Personal Care",
    subCategory: "Hair",
    items: [
      {
        name: "Anti-Hairfall Onion & Bhringraj Shampoo",
        price: 360,
        originalPrice: 420,
        unit: "300 ml Bottle",
        stock: 90,
        brand: "Himalaya Pure",
        description: "Sulphate-free botanical shampoo formulated with red onion seed oil to strengthen hair roots.",
        image: "https://images.unsplash.com/photo-1535585209827-a15fcdbc4c2d?w=800&auto=format&fit=crop&q=80",
        tags: ["Shampoo", "Haircare", "Onion", "Anti-Hairfall"],
      },
      {
        name: "Moroccan Argan Hair Serum & Elixir",
        price: 450,
        originalPrice: 520,
        unit: "100 ml Bottle",
        stock: 65,
        brand: "Himalaya Pure",
        description: "Lightweight, non-greasy hair serum infused with cold-pressed pure Argan oil for frizz control.",
        image: "https://images.unsplash.com/photo-1608248597359-002d2888c3f1?w=800&auto=format&fit=crop&q=80",
        tags: ["Hair Serum", "Argan Oil", "Shine", "Haircare"],
      },
    ],
  },
  {
    category: "Beauty & Personal Care",
    subCategory: "Skin & Faces",
    items: [
      {
        name: "Vitamin C Radiance Face Wash",
        price: 240,
        originalPrice: 280,
        unit: "150 ml Tube",
        stock: 120,
        brand: "Himalaya Pure",
        description: "Gentle foaming cleanser with Vitamin C and turmeric extracts to brighten skin and remove dirt.",
        image: "https://images.unsplash.com/photo-1556228720-195a672e8a03?w=800&auto=format&fit=crop&q=80",
        tags: ["Face Wash", "Skincare", "Vitamin C", "Brightening"],
      },
      {
        name: "Hydrating Hyaluronic Acid Day Gel Cream",
        price: 490,
        originalPrice: 580,
        unit: "50 g Jar",
        stock: 75,
        brand: "Himalaya Pure",
        description: "Ultra-lightweight oil-free moisturizer providing 72-hour deep cellular hydration with hyaluronic acid.",
        image: "https://images.unsplash.com/photo-1598440947619-2c35fc9aa908?w=800&auto=format&fit=crop&q=80",
        tags: ["Moisturizer", "Face Cream", "Hyaluronic", "Hydration"],
      },
    ],
  },
  {
    category: "Beauty & Personal Care",
    subCategory: "Beauty & Cosmetics",
    items: [
      {
        name: "Velvet Matte Liquid Lipstick - Berry Wine",
        price: 380,
        originalPrice: 450,
        unit: "6 ml Wand",
        stock: 90,
        brand: "Himalaya Pure",
        description: "Long-lasting 12-hour transfer-proof matte liquid lipstick enriched with Vitamin E and Jojoba oil.",
        image: "https://images.unsplash.com/photo-1586495777744-4413f21062fa?w=800&auto=format&fit=crop&q=80",
        tags: ["Lipstick", "Cosmetics", "Makeup", "Matte"],
      },
      {
        name: "Volumizing Waterproof Kohl Eyeliner Pen",
        price: 220,
        originalPrice: 260,
        unit: "1.2 g Pen",
        stock: 100,
        brand: "Himalaya Pure",
        description: "Intense matte black smudge-proof and waterproof kajal eyeliner that lasts up to 24 hours.",
        image: "https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=800&auto=format&fit=crop&q=80",
        tags: ["Eyeliner", "Kajal", "Makeup", "Cosmetics"],
      },
    ],
  },
  {
    category: "Beauty & Personal Care",
    subCategory: "Feminine Hygiene",
    items: [
      {
        name: "Ultra Thin Organic Cotton Sanitary Pads (XXL)",
        price: 240,
        originalPrice: 280,
        unit: "Pack of 20",
        stock: 130,
        brand: "Himalaya Pure",
        description: "Super absorbent, rash-free organic cotton sanitary napkins with wider wings for night protection.",
        image: "https://images.unsplash.com/photo-1583947215259-38e31be8751f?w=800&auto=format&fit=crop&q=80",
        tags: ["Sanitary Pads", "Hygiene", "Organic", "Wellness"],
      },
      {
        name: "Gentle pH Balanced Intimate Wash",
        price: 195,
        originalPrice: 230,
        unit: "100 ml Bottle",
        stock: 80,
        brand: "Himalaya Pure",
        description: "Dermatologically tested intimate wash infused with tea tree oil and aloe vera to maintain 3.5 pH balance.",
        image: "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=800&auto=format&fit=crop&q=80",
        tags: ["Intimate Wash", "Hygiene", "Care", "Aloe"],
      },
    ],
  },
  {
    category: "Beauty & Personal Care",
    subCategory: "Fragrances & Deodorants",
    items: [
      {
        name: "Luxury French Lavender Eau De Parfum",
        price: 799,
        originalPrice: 1199,
        unit: "100 ml Glass Spray Bottle",
        stock: 60,
        brand: "Himalaya Pure",
        description: "Elegant long-lasting French lavender and vanilla blend fragrance with rich top notes of bergamot and amber.",
        image: "https://images.unsplash.com/photo-1594035910387-fea47794261f?w=800&auto=format&fit=crop&q=80",
        tags: ["Perfume", "Fragrance", "Eau De Parfum", "Beauty"],
      },
      {
        name: "Fresh Citrus Breeze Daily Body Mist Spray",
        price: 349,
        originalPrice: 499,
        unit: "150 ml Spray Can",
        stock: 120,
        brand: "Himalaya Pure",
        description: "Refreshing all-day odor protection body spray enriched with citrus extracts and soothing aloe.",
        image: "https://images.unsplash.com/photo-1608248597359-002d2888c3f1?w=800&auto=format&fit=crop&q=80",
        tags: ["Body Mist", "Deodorant", "Fresh", "Fragrance"],
      },
    ],
  },
  {
    category: "Beauty & Personal Care",
    subCategory: "Health & Pharma",
    items: [
      {
        name: "Daily Multivitamin & Zinc Immunity Booster",
        price: 420,
        originalPrice: 490,
        unit: "60 Tablets Bottle",
        stock: 90,
        brand: "Himalaya Pure",
        description: "Complete daily nutrition tablet containing essential vitamins A, C, D3, E, B-Complex and Zinc.",
        image: "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=800&auto=format&fit=crop&q=80",
        tags: ["Multivitamin", "Immunity", "Health", "Supplements"],
      },
      {
        name: "Fast Action Herbal Pain Relief Ointment Gel",
        price: 140,
        originalPrice: 165,
        unit: "50 g Tube",
        stock: 110,
        brand: "Himalaya Pure",
        description: "Quick absorbing ayurvedic pain relief balm enriched with wintergreen oil and eucalyptus for muscle pain.",
        image: "https://images.unsplash.com/photo-1628771065518-0d82f1938462?w=800&auto=format&fit=crop&q=80",
        tags: ["Pain Relief", "Herbal", "Balm", "Health"],
      },
    ],
  },
  {
    category: "Beauty & Personal Care",
    subCategory: "Sexual Wellness",
    items: [
      {
        name: "Ultra Thin Lubricated Natural Latex Condoms",
        price: 220,
        originalPrice: 260,
        unit: "Pack of 10",
        stock: 120,
        brand: "Himalaya Pure",
        description: "Electrically tested ultra-thin premium condoms designed for maximum sensitivity, comfort, and safety.",
        image: "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=800&auto=format&fit=crop&q=80",
        tags: ["Wellness", "Condoms", "Latex", "Safety"],
      },
      {
        name: "Natural Water-Based Aloe Vera Intimate Gel",
        price: 340,
        originalPrice: 399,
        unit: "100 ml Pump Bottle",
        stock: 65,
        brand: "Himalaya Pure",
        description: "Silky smooth, non-sticky water-soluble personal lubricant infused with natural organic aloe vera extract.",
        image: "https://images.unsplash.com/photo-1608248597359-002d2888c3f1?w=800&auto=format&fit=crop&q=80",
        tags: ["Lubricant", "Gel", "Aloe Vera", "Wellness"],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. SCHOOL, OFFICE & STATIONERY (4 Subcategories × 2 Products = 8 Products)
  // ─────────────────────────────────────────────────────────────────────────────
  // 4. SCHOOL, OFFICE & STATIONERY (8 Subcategories × 2 Products = 16 Products)
  // ─────────────────────────────────────────────────────────────────────────────
  {
    category: "School, Office & Stationery",
    subCategory: "Pens & Pencils",
    items: [
      {
        name: "Smooth Flow Gel Ballpoint Pens (Blue & Black)",
        price: 120,
        originalPrice: 150,
        unit: "Pack of 10 Pens",
        stock: 180,
        brand: "Bhansa Mart Choice",
        description: "Japanese waterproof ink 0.5mm tip gel pens with rubberized non-slip grip for effortless handwriting.",
        image: "https://images.unsplash.com/photo-1583485088034-697b5bc54ccd?w=800&auto=format&fit=crop&q=80",
        tags: ["Pens", "Gel Pens", "Writing", "Stationery"],
      },
      {
        name: "Premium Retractable Mechanical Pencil Set + Erasers",
        price: 180,
        originalPrice: 210,
        unit: "Set of 3 (0.5mm, 0.7mm) + Leads & Erasers",
        stock: 85,
        brand: "Bhansa Mart Choice",
        description: "Metal body precision mechanical pencils with comfortable knurled grip, polymer lead refills and dust-free erasers.",
        image: "https://images.unsplash.com/photo-1585336261026-7fcfbdfa95b8?w=800&auto=format&fit=crop&q=80",
        tags: ["Pencil", "Mechanical", "Drawing", "Drafting", "Eraser"],
      },
    ],
  },
  {
    category: "School, Office & Stationery",
    subCategory: "Notebooks & Diaries",
    items: [
      {
        name: "Spiral Bound College Ruled Notebooks",
        price: 240,
        originalPrice: 280,
        unit: "Pack of 4 (180 Pages)",
        stock: 130,
        brand: "Classmate",
        description: "Premium 75 GSM bright white paper spiral notebooks with water-resistant polypropylene covers.",
        image: "https://images.unsplash.com/photo-1531346878377-a5be20888e57?w=800&auto=format&fit=crop&q=80",
        tags: ["Notebooks", "Spiral", "School", "Stationery"],
      },
      {
        name: "Executive Hardbound Daily Planner Diary (A5)",
        price: 320,
        originalPrice: 420,
        unit: "1 Diary (365 Pages)",
        stock: 75,
        brand: "Paperkraft",
        description: "Elegant faux-leather hardbound daily organizer diary with ribbon bookmark, pen loop, and gold gilt edges.",
        image: "https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=800&auto=format&fit=crop&q=80",
        tags: ["Diary", "Planner", "Office", "Notebook"],
      },
    ],
  },
  {
    category: "School, Office & Stationery",
    subCategory: "Markers & Highlighters",
    items: [
      {
        name: "Pastel Aesthetic Chisel Tip Highlighters Set",
        price: 190,
        originalPrice: 250,
        unit: "Pack of 6 Colors",
        stock: 110,
        brand: "Stabilo Boss",
        description: "Soft pastel water-based ink highlighters with anti-dry technology and dual chisel tips for journaling and studying.",
        image: "https://images.unsplash.com/photo-1583485088034-697b5bc54ccd?w=800&auto=format&fit=crop&q=80",
        tags: ["Highlighters", "Markers", "Pastel", "Study"],
      },
      {
        name: "Dual-Tip Permanent Whiteboard & Art Markers",
        price: 220,
        originalPrice: 290,
        unit: "Set of 4 (Black, Blue, Red, Green)",
        stock: 90,
        brand: "Camlin",
        description: "Quick-drying, low-odor erasable whiteboard and permanent flipchart markers with dense vibrant pigments.",
        image: "https://images.unsplash.com/photo-1585336261026-7fcfbdfa95b8?w=800&auto=format&fit=crop&q=80",
        tags: ["Markers", "Whiteboard", "Office", "Permanent"],
      },
    ],
  },
  {
    category: "School, Office & Stationery",
    subCategory: "Geometry & Scales",
    items: [
      {
        name: "Stainless Steel Mathematical Geometry Box",
        price: 190,
        originalPrice: 230,
        unit: "Complete Set with Tin Box",
        stock: 95,
        brand: "Camlin Kokuyo",
        description: "All-in-one geometry set containing self-centering compass, divider, protractor, set squares, and scale.",
        image: "https://images.unsplash.com/photo-1585336261026-7fcfbdfa95b8?w=800&auto=format&fit=crop&q=80",
        tags: ["Geometry Box", "Math", "Compass", "School"],
      },
      {
        name: "Clear Acrylic 30cm Metric Scale Ruler Set",
        price: 80,
        originalPrice: 110,
        unit: "Pack of 2 (30cm & 15cm)",
        stock: 150,
        brand: "Faber-Castell",
        description: "Durable shatter-resistant transparent acrylic rulers with bold, easy-to-read metric and inch markings.",
        image: "https://images.unsplash.com/photo-1583485088034-697b5bc54ccd?w=800&auto=format&fit=crop&q=80",
        tags: ["Ruler", "Scale", "Geometry", "School"],
      },
    ],
  },
  {
    category: "School, Office & Stationery",
    subCategory: "Art & Craft Supplies",
    items: [
      {
        name: "Professional 24-Color Acrylic Paint Tubes Set",
        price: 580,
        originalPrice: 680,
        unit: "24 Tubes × 12ml",
        stock: 55,
        brand: "Camel Artist",
        description: "Vibrant, high pigment acrylic colors with smooth satin finish suitable for canvas, wood, paper, and fabric.",
        image: "https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=800&auto=format&fit=crop&q=80",
        tags: ["Acrylic Paint", "Art", "Painting", "Craft"],
      },
      {
        name: "Rich Pigment Color Pencils & Drawing Book Set",
        price: 340,
        originalPrice: 420,
        unit: "24 Color Pencils + 40 Page Sketchpad",
        stock: 80,
        brand: "Faber-Castell",
        description: "Break-resistant triangular color pencils with silky-smooth laydown paired with a premium spiral drawing book.",
        image: "https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=800&auto=format&fit=crop&q=80",
        tags: ["Color Pencils", "Drawing Book", "Art", "Sketching", "Crayons"],
      },
    ],
  },
  {
    category: "School, Office & Stationery",
    subCategory: "Files & Folders",
    items: [
      {
        name: "12-Pocket Expanding Document File Organizer",
        price: 360,
        originalPrice: 450,
        unit: "A4 Size Accordion Folder",
        stock: 65,
        brand: "Solo",
        description: "Heavy-duty waterproof poly expanding file folder with customizable color index tabs and secure elastic closure.",
        image: "https://images.unsplash.com/photo-1587829741301-dc798b83add3?w=800&auto=format&fit=crop&q=80",
        tags: ["Files", "Folders", "Document Organizer", "Office"],
      },
      {
        name: "Clear View Presentation Display Folders & Envelopes",
        price: 190,
        originalPrice: 250,
        unit: "Pack of 5 Folders + 10 Envelopes",
        stock: 120,
        brand: "Solo",
        description: "Transparent non-stick sheet protector folders suitable for reports, certificates, resumes, and mailing envelopes.",
        image: "https://images.unsplash.com/photo-1583485088034-697b5bc54ccd?w=800&auto=format&fit=crop&q=80",
        tags: ["Folders", "Envelopes", "Certificates", "Office"],
      },
    ],
  },
  {
    category: "School, Office & Stationery",
    subCategory: "Office & Desk Supplies",
    items: [
      {
        name: "Heavy Duty Desktop Office Stapler & 2000 Pins",
        price: 280,
        originalPrice: 340,
        unit: "1 Set with Pin Box",
        stock: 75,
        brand: "Kangaro",
        description: "Robust metal body stapler capable of binding up to 30 sheets with built-in integrated staple remover.",
        image: "https://images.unsplash.com/photo-1583485088034-697b5bc54ccd?w=800&auto=format&fit=crop&q=80",
        tags: ["Stapler", "Office", "Desk", "Supplies", "Staples"],
      },
      {
        name: "Multipurpose Mesh Desk Organizer & Paper Clips Set",
        price: 390,
        originalPrice: 490,
        unit: "6-Compartment Caddy + 100 Binder Clips",
        stock: 60,
        brand: "Executive Hub",
        description: "Compact metal mesh desk tidy organizer with slide drawer for pens, calculators, adhesives, and paper clips.",
        image: "https://images.unsplash.com/photo-1507842229451-79b1be886a20?w=800&auto=format&fit=crop&q=80",
        tags: ["Desk Organizer", "Paper Clips", "Calculators", "Adhesives", "Office Supplies"],
      },
    ],
  },
  {
    category: "School, Office & Stationery",
    subCategory: "Printer Paper & Labels",
    items: [
      {
        name: "Multipurpose A4 Printing & Copier Paper",
        price: 460,
        originalPrice: 520,
        unit: "Ream of 500 Sheets (75 GSM)",
        stock: 140,
        brand: "Double A",
        description: "High brightness, jam-free 75 GSM A4 copy paper ideal for laser, inkjet, and high-speed photocopying.",
        image: "https://images.unsplash.com/photo-1586075010923-2dd4570fb338?w=800&auto=format&fit=crop&q=80",
        tags: ["A4 Paper", "Copy Paper", "Printing", "Printer Paper"],
      },
      {
        name: "Neon Pastel Sticky Notes & Index Label Flags",
        price: 150,
        originalPrice: 200,
        unit: "4 Pads (300 Sheets) + 100 Flags",
        stock: 160,
        brand: "3M Post-it",
        description: "Self-adhesive repositionable vibrant sticky notes and page markers that stick firmly without leaving residue.",
        image: "https://images.unsplash.com/photo-1586075010923-2dd4570fb338?w=800&auto=format&fit=crop&q=80",
        tags: ["Sticky Notes", "Labels", "Stickers", "Index Flags"],
      },
    ],
  },
  // ─────────────────────────────────────────────────────────────────────────────
  // 5. BABY (7 Subcategories × 2 Products = 14 Products)
  // ─────────────────────────────────────────────────────────────────────────────
  {
    category: "Baby",
    subCategory: "Baby Food",
    items: [
      {
        name: "Nestle Cerelac Baby Cereal Wheat & Apple",
        price: 320,
        originalPrice: 360,
        unit: "300 g Box",
        stock: 90,
        brand: "Nestle",
        description: "Nutritious baby cereal enriched with iron, vitamins A, C, and D, and zinc for healthy growth and development from 6+ months.",
        image: "https://images.unsplash.com/photo-1596461404969-9ae70f2830c1?w=800&auto=format&fit=crop&q=80",
        tags: ["Baby Food", "Cerelac", "Cereal", "Infant Nutrition", "Baby"],
      },
      {
        name: "Organic Apple, Banana & Berry Puree Pouch",
        price: 180,
        originalPrice: 220,
        unit: "120 g Pouch",
        stock: 120,
        brand: "Little Spoon",
        description: "100% certified organic fruit puree blend with no added sugars or artificial preservatives for early weaning stages.",
        image: "https://images.unsplash.com/photo-1615485290382-441e4d049cb5?w=800&auto=format&fit=crop&q=80",
        tags: ["Baby Food", "Puree", "Organic", "Fruit Pouch", "Baby"],
      },
    ],
  },
  {
    category: "Baby",
    subCategory: "Diapers & Pants",
    items: [
      {
        name: "Molfix Air-Dry Soft Baby Diapers (Medium)",
        price: 850,
        originalPrice: 999,
        unit: "Pack of 54 Diapers",
        stock: 150,
        brand: "Molfix",
        description: "Ultra-absorbent breathable soft diapers with wetness indicator and gentle leak-proof elastic leg cuffs.",
        image: "https://images.unsplash.com/photo-1584820927498-cfe5211fd8bf?w=800&auto=format&fit=crop&q=80",
        tags: ["Diapers", "Baby Diapers", "Molfix", "Pants", "Baby Care"],
      },
      {
        name: "Pampers All-Round Protection Active Baby Pants",
        price: 920,
        originalPrice: 1100,
        unit: "Pack of 62 Pants",
        stock: 130,
        brand: "Pampers",
        description: "Easy pull-up baby pant diapers with 360-degree soft cottony waistband and 12-hour ultra leak lock system.",
        image: "https://images.unsplash.com/photo-1515488042361-ee00e0ddd4e4?w=800&auto=format&fit=crop&q=80",
        tags: ["Pampers", "Baby Pants", "Diapers", "Active Baby"],
      },
    ],
  },
  {
    category: "Baby",
    subCategory: "Baby Care",
    items: [
      {
        name: "Himalaya Nourishing Baby Daily Lotion with Olive Oil",
        price: 240,
        originalPrice: 290,
        unit: "400 ml Pump Bottle",
        stock: 110,
        brand: "Himalaya BabyCare",
        description: "Clinically tested gentle moisturizer with natural olive oil and almond extract to keep baby's delicate skin soft and hydrated.",
        image: "https://images.unsplash.com/photo-1515488042361-ee00e0ddd4e4?w=800&auto=format&fit=crop&q=80",
        tags: ["Baby Care", "Baby Lotion", "Moisturizer", "Himalaya"],
      },
      {
        name: "Soothe & Protect Zinc Oxide Diaper Rash Cream",
        price: 210,
        originalPrice: 260,
        unit: "100 g Tube",
        stock: 95,
        brand: "Sebamed Baby",
        description: "Fast-acting hypoallergenic rash relief barrier cream enriched with zinc oxide and chamomile extract to calm irritation.",
        image: "https://images.unsplash.com/photo-1556228720-195a672e8a03?w=800&auto=format&fit=crop&q=80",
        tags: ["Diaper Rash", "Baby Cream", "Skin Care", "Baby Care"],
      },
    ],
  },
  {
    category: "Baby",
    subCategory: "Baby Bath",
    items: [
      {
        name: "Gentle No-Tears Baby Head-to-Toe Body Wash",
        price: 290,
        originalPrice: 350,
        unit: "500 ml Bottle",
        stock: 85,
        brand: "Himalaya BabyCare",
        description: "Mild soap-free cleanser enriched with green gram and chickpea protein for tear-free gentle daily baths.",
        image: "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=800&auto=format&fit=crop&q=80",
        tags: ["Baby Bath", "Baby Wash", "Tear-Free", "Gentle Cleanser"],
      },
      {
        name: "Organic Coconut & Chamomile Baby Shampoo",
        price: 340,
        originalPrice: 400,
        unit: "300 ml Pump Bottle",
        stock: 75,
        brand: "Mamaearth",
        description: "Toxin-free, pH 5.6 balanced gentle baby shampoo for soft, tangle-free hair with natural conditioning coconut oil.",
        image: "https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=800&auto=format&fit=crop&q=80",
        tags: ["Baby Shampoo", "Baby Bath", "Tear-Free", "Organic"],
      },
    ],
  },
  {
    category: "Baby",
    subCategory: "Baby Feeding",
    items: [
      {
        name: "Anti-Colic BPA-Free Natural Flow Feeding Bottle",
        price: 380,
        originalPrice: 480,
        unit: "260 ml / 9 oz",
        stock: 100,
        brand: "Philips Avent",
        description: "Clinically proven anti-colic feeding bottle with natural breast-shaped silicone teat for effortless latch-on.",
        image: "https://images.unsplash.com/photo-1596461404969-9ae70f2830c1?w=800&auto=format&fit=crop&q=80",
        tags: ["Feeding Bottle", "Baby Feeding", "Anti-Colic", "BPA-Free"],
      },
      {
        name: "Food-Grade Soft Silicone Feeding Spoons & Bib Set",
        price: 290,
        originalPrice: 380,
        unit: "Set of 2 Spoons + 1 Waterproof Bib",
        stock: 80,
        brand: "LuvLap",
        description: "Flexible gum-friendly soft silicone baby spoons paired with a deep catcher waterproof adjustable bib.",
        image: "https://images.unsplash.com/photo-1515488042361-ee00e0ddd4e4?w=800&auto=format&fit=crop&q=80",
        tags: ["Baby Feeding", "Silicone Spoons", "Baby Bib", "Weaning"],
      },
    ],
  },
  {
    category: "Baby",
    subCategory: "Baby Clothing",
    items: [
      {
        name: "100% Pure Organic Cotton Baby Rompers & Onesies",
        price: 550,
        originalPrice: 750,
        unit: "Pack of 3 (0-6 Months)",
        stock: 70,
        brand: "Mothercare",
        description: "Breathable ultra-soft combed cotton snap-button rompers designed for easy diaper changes and cozy all-day comfort.",
        image: "https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af?w=800&auto=format&fit=crop&q=80",
        tags: ["Baby Clothing", "Onesies", "Rompers", "Cotton", "Baby Wear"],
      },
      {
        name: "Plush Hooded Animal Ears Baby Bath Towel Wrap",
        price: 390,
        originalPrice: 520,
        unit: "75 cm × 75 cm",
        stock: 65,
        brand: "FirstCry",
        description: "Super absorbent microfiber terry cotton hooded baby wrap with adorable bear ears for post-bath warmth.",
        image: "https://images.unsplash.com/photo-1515488042361-ee00e0ddd4e4?w=800&auto=format&fit=crop&q=80",
        tags: ["Baby Towel", "Hooded Towel", "Baby Clothing", "Bath Wrap"],
      },
    ],
  },
  {
    category: "Baby",
    subCategory: "Baby Accessories",
    items: [
      {
        name: "BPA-Free Silicone Sensory Soothing Teether Ring",
        price: 199,
        originalPrice: 280,
        unit: "1 pc",
        stock: 140,
        brand: "Mee Mee",
        description: "Textured multi-surface cooling water teether designed to soothe sore gums during infant teething stages.",
        image: "https://images.unsplash.com/photo-1596461404969-9ae70f2830c1?w=800&auto=format&fit=crop&q=80",
        tags: ["Teether", "Baby Accessories", "Teething Toy", "BPA Free"],
      },
      {
        name: "Colorful Soft Plush Rattle & Squeaker Toy Set",
        price: 280,
        originalPrice: 380,
        unit: "Set of 3 Soft Rattles",
        stock: 90,
        brand: "Fisher-Price",
        description: "High-contrast lightweight developmental wrist and foot rattle toys that encourage sensory grasp and motor skills.",
        image: "https://images.unsplash.com/photo-1515488042361-ee00e0ddd4e4?w=800&auto=format&fit=crop&q=80",
        tags: ["Rattles", "Baby Accessories", "Sensory Toys", "Plush Toys"],
      },
    ],
  },
  // ─────────────────────────────────────────────────────────────────────────────
  // 6. GIFTING (8 Subcategories × 2 Products = 16 Products)
  // ─────────────────────────────────────────────────────────────────────────────
  {
    category: "Gifting",
    subCategory: "Men's Wear",
    items: [
      {
        name: "Premium Breathable Pique Cotton Polo Shirt",
        price: 1250,
        originalPrice: 1650,
        unit: "Size L - Navy Blue",
        stock: 60,
        brand: "Urban Classics",
        description: "Tailored fit 100% premium combed cotton polo t-shirt with ribbed collar and embroidered emblem.",
        image: "https://images.unsplash.com/photo-1581655353564-df123a1eb820?w=800&auto=format&fit=crop&q=80",
        tags: ["Men's Wear", "Polo", "Shirt", "Gifting", "Fashion"],
      },
      {
        name: "Classic Stretch Slim-Fit Chinos Trousers",
        price: 1850,
        originalPrice: 2400,
        unit: "Size 32 - Khaki",
        stock: 45,
        brand: "Park Avenue",
        description: "Versatile four-way stretch slim-fit cotton chinos designed for effortless daily smart-casual elegance.",
        image: "https://images.unsplash.com/photo-1624378439575-d8705ad7ae80?w=800&auto=format&fit=crop&q=80",
        tags: ["Men's Wear", "Chinos", "Trousers", "Formal", "Gifting"],
      },
    ],
  },
  {
    category: "Gifting",
    subCategory: "Women's Wear",
    items: [
      {
        name: "Handcrafted Pure Pashmina Silk Shawl",
        price: 2450,
        originalPrice: 3200,
        unit: "2 m × 1 m Stole",
        stock: 35,
        brand: "Himalayan Weaves",
        description: "Exquisite hand-woven pure Pashmina silk stole with intricate floral embroidery borders.",
        image: "https://images.unsplash.com/photo-1601924994987-69e26d50dc26?w=800&auto=format&fit=crop&q=80",
        tags: ["Women's Wear", "Shawl", "Pashmina", "Silk", "Gift"],
      },
      {
        name: "Graceful Chiffon Floral Print Kurti Set",
        price: 1750,
        originalPrice: 2300,
        unit: "Set with Dupatta (Size M)",
        stock: 50,
        brand: "Aurelia Style",
        description: "Flowy pastel floral chiffon flared kurti set paired with delicate matching dupatta and palazzo pants.",
        image: "https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=800&auto=format&fit=crop&q=80",
        tags: ["Women's Wear", "Kurti", "Ethnic", "Dresses", "Festive"],
      },
    ],
  },
  {
    category: "Gifting",
    subCategory: "Electronics & Gadgets",
    items: [
      {
        name: "Pro True Wireless Active Noise Cancelling Earbuds",
        price: 2990,
        originalPrice: 4200,
        unit: "Black (with Charging Case)",
        stock: 55,
        brand: "SoundPulse Audio",
        description: "High-definition bass Bluetooth 5.3 earbuds with 32-hour playback battery and deep noise cancellation.",
        image: "https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=800&auto=format&fit=crop&q=80",
        tags: ["Electronics", "Earbuds", "Bluetooth", "Audio", "Gadgets", "Gifting"],
      },
      {
        name: "Smart AMOLED Fitness Tracker Watch with SpO2",
        price: 3450,
        originalPrice: 4800,
        unit: "Midnight Black Band",
        stock: 40,
        brand: "FitTrack Pro",
        description: "Waterproof smart smartwatch with always-on AMOLED display, heart rate monitor, sleep tracking and 100+ sports modes.",
        image: "https://images.unsplash.com/photo-1579586337278-3befd40fd17a?w=800&auto=format&fit=crop&q=80",
        tags: ["Electronics", "Smartwatch", "Fitness Tracker", "Gadgets", "Gifting"],
      },
    ],
  },
  {
    category: "Gifting",
    subCategory: "Chocolates & Sweets",
    items: [
      {
        name: "Deluxe Handcrafted Belgian Dark Chocolate Gift Box",
        price: 890,
        originalPrice: 1200,
        unit: "24 Pralines Assortment (300g)",
        stock: 90,
        brand: "ChocoLuxe Artisan",
        description: "Assorted gourmet Belgian pralines, hazelnut truffles, and rich dark chocolate ganache in golden presentation packaging.",
        image: "https://images.unsplash.com/photo-1549007994-cb92caebd54b?w=800&auto=format&fit=crop&q=80",
        tags: ["Chocolates", "Gourmet", "Belgian", "Sweets", "Gift Box"],
      },
      {
        name: "Cadbury Celebrations Rich Dry Fruit Gift Pack",
        price: 650,
        originalPrice: 850,
        unit: "350g Gift Tin",
        stock: 110,
        brand: "Cadbury",
        description: "Festive celebration pack packed with almond magic, cashew delight, and roasted hazelnut chocolate bars.",
        image: "https://images.unsplash.com/photo-1526081347589-7fa3cb41b4b2?w=800&auto=format&fit=crop&q=80",
        tags: ["Chocolates", "Cadbury", "Celebrations", "Dry Fruits", "Festive"],
      },
    ],
  },
  {
    category: "Gifting",
    subCategory: "Cosmetics & Hampers",
    items: [
      {
        name: "Luxury Rose Gold Glow Skincare & Makeup Gift Hamper",
        price: 2450,
        originalPrice: 3500,
        unit: "5-in-1 Deluxe Beauty Kit",
        stock: 45,
        brand: "GlowAura Beauty",
        description: "Luxurious beauty gift box featuring vitamin C serum, velvet matte lipstick, illuminating primer, and compact blush.",
        image: "https://images.unsplash.com/photo-1512496015851-a90fb38ba796?w=800&auto=format&fit=crop&q=80",
        tags: ["Cosmetics", "Makeup", "Beauty Hamper", "Gift Kit", "Glow"],
      },
      {
        name: "Ayurvedic Royal Essential Spa & Bath Relaxation Set",
        price: 1650,
        originalPrice: 2200,
        unit: "4-Piece Spa Kit",
        stock: 60,
        brand: "Forest Elixir",
        description: "Aromatherapy bath salt crystals, jasmine body butter, sandalwood essential oil, and natural loofah scrub.",
        image: "https://images.unsplash.com/photo-1556228720-195a672e8a03?w=800&auto=format&fit=crop&q=80",
        tags: ["Cosmetics", "Spa Hamper", "Bath Care", "Aromatherapy", "Gifting"],
      },
    ],
  },
  {
    category: "Gifting",
    subCategory: "Dresses & Ethnic Wear",
    items: [
      {
        name: "Festive Royal Embroidered Anarkali Gown",
        price: 3200,
        originalPrice: 4500,
        unit: "Embroidered Silk (Size L)",
        stock: 30,
        brand: "Vedic Glamour",
        description: "Heavy zardozi embroidery flared festive Anarkali gown with net dupatta for weddings and joyous celebrations.",
        image: "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=800&auto=format&fit=crop&q=80",
        tags: ["Dresses", "Anarkali", "Ethnic Wear", "Party Wear", "Gifting"],
      },
      {
        name: "Sleek Satin Slip Evening Party Dress",
        price: 1950,
        originalPrice: 2700,
        unit: "Emerald Green (Size M)",
        stock: 40,
        brand: "Zara Chic",
        description: "Glossy bias-cut emerald green satin cocktail dress with cowl neckline and elegant side slit.",
        image: "https://images.unsplash.com/photo-1595777457583-95e059d581b8?w=800&auto=format&fit=crop&q=80",
        tags: ["Dresses", "Western Dress", "Evening Gown", "Party Wear", "Fashion"],
      },
    ],
  },
  {
    category: "Gifting",
    subCategory: "Kids & Baby Gifts",
    items: [
      {
        name: "Deluxe Newborn Welcome Organic Hamper Gift Box",
        price: 1850,
        originalPrice: 2500,
        unit: "7-Piece Baby Set",
        stock: 50,
        brand: "FirstCry Baby",
        description: "Complete newborn starter gift set: organic onesie, soft cap, mittens, booties, pacifier clip, and organic massage oil.",
        image: "https://images.unsplash.com/photo-1515488042361-ee00e0ddd4e4?w=800&auto=format&fit=crop&q=80",
        tags: ["Kids", "Baby Gifts", "Newborn Hamper", "Baby Clothing", "Gift Box"],
      },
      {
        name: "Interactive Musical Sit-to-Stand Learning Walker",
        price: 2150,
        originalPrice: 2900,
        unit: "1 Activity Center",
        stock: 35,
        brand: "Fisher-Price",
        description: "Engaging early learning activity walker with musical piano keys, animal sounds, flashing lights, and gear spinners.",
        image: "https://images.unsplash.com/photo-1596461404969-9ae70f2830c1?w=800&auto=format&fit=crop&q=80",
        tags: ["Kids", "Baby Toys", "Activity Walker", "Learning", "Gift"],
      },
    ],
  },
  {
    category: "Gifting",
    subCategory: "Toys & Games",
    items: [
      {
        name: "High-Speed Remote Control 4WD Off-Road Monster Truck",
        price: 1650,
        originalPrice: 2300,
        unit: "1:16 Scale with Rechargeable Battery",
        stock: 65,
        brand: "SpeedRacer RC",
        description: "All-terrain 2.4GHz remote-controlled stunt monster truck with shock absorbers and LED headlights.",
        image: "https://images.unsplash.com/photo-1594787318286-3d835c1d207f?w=800&auto=format&fit=crop&q=80",
        tags: ["Toys", "RC Car", "Remote Control", "Games", "Kids Gift"],
      },
      {
        name: "Premium Wooden 3-in-1 Chess, Checkers & Ludo Board Set",
        price: 1100,
        originalPrice: 1550,
        unit: "14-inch Foldable Magnetic Board",
        stock: 75,
        brand: "Classic Games",
        description: "Handcrafted magnetic wooden strategy board game combo featuring carved chessmen, checkers, and ludo.",
        image: "https://images.unsplash.com/photo-1529699211952-734e80c4d42b?w=800&auto=format&fit=crop&q=80",
        tags: ["Toys", "Board Games", "Chess", "Strategy Games", "Family Gift"],
      },
    ],
  },
];

async function seedDatabase() {
  try {
    console.log("Connecting to MongoDB at:", MONGO_URI.replace(/:([^@]+)@/, ":****@"));
    await mongoose.connect(MONGO_URI);
    console.log("Connected to MongoDB successfully!");

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 1: Seed 2 Vendors (Users + Vendor documents)
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- Seeding 2 Vendors ---");

    // Vendor 1
    const vendor1Email = "annapurna.vendor@bhansamart.com";
    let user1 = await User.findOne({ email: vendor1Email });
    if (!user1) {
      user1 = await User.create({
        name: "Annapurna Organics & Superstore",
        email: vendor1Email,
        password: "Password@123",
        phone: "9801234567",
        address: "New Road, Kathmandu",
        role: "vendor",
        status: "active",
        isApproved: true,
        isEmailVerified: true,
      });
      console.log(`Created Vendor 1 User: ${user1.email}`);
    } else {
      console.log(`Found Existing Vendor 1 User: ${user1.email}`);
    }

    let vendor1 = await Vendor.findOne({ userId: user1._id });
    if (!vendor1) {
      vendor1 = await Vendor.create({
        userId: user1._id,
        businessDetails: {
          businessName: "Annapurna Organics & Kitchen Hub",
          businessType: "Pvt. Ltd.",
          gstNumber: "27ABCDE1234F1Z5",
          panNumber: "ABCDE1234F",
          businessEmail: vendor1Email,
          businessPhone: "9801234567",
          yearEstablished: 2019,
          numberOfEmployees: 25,
          categories: ["Grocery & Kitchen", "Snacks & Drinks"],
          retailChannel: "Both Online & Retail",
        },
        sellerDetails: {
          sellerName: "Ramesh Shrestha",
          sellerEmail: "ramesh@annapurnagroup.com",
          sellerPhone: "9801234567",
          address: "New Road, Ward 22",
          city: "Kathmandu",
          state: "Bagmati",
          pincode: "44600",
        },
        brandDetails: {
          brandName: "Annapurna Gold",
          brandType: "Organic & Kitchen",
          trademarkNumber: "TM-984321",
          brandWebsite: "https://annapurnagroup.com",
          brandLogo:
            "https://images.unsplash.com/photo-1542838132-92c53300491e?w=500&auto=format&fit=crop&q=60",
        },
        bankDetails: {
          accountHolderName: "Annapurna Organics Pvt Ltd",
          accountNumber: "01234567890123",
          ifscCode: "NABIL00123",
          bankName: "Nabil Bank Ltd",
          branch: "New Road Branch",
        },
        shippingLocations: {
          warehouseAddress: "Balkhu Hub Warehouse, Kathmandu",
          city: "Kathmandu",
          state: "Bagmati",
          pincode: "44600",
        },
        status: "approved",
      });
      console.log(`Created Vendor 1 Record: ${vendor1.businessDetails.businessName}`);
    } else {
      console.log(`Found Existing Vendor 1 Record: ${vendor1.businessDetails.businessName}`);
    }

    // Vendor 2
    const vendor2Email = "himalayan.care@bhansamart.com";
    let user2 = await User.findOne({ email: vendor2Email });
    if (!user2) {
      user2 = await User.create({
        name: "Himalayan Care & Stationery Hub",
        email: vendor2Email,
        password: "Password@123",
        phone: "9812345678",
        address: "Pulchowk, Lalitpur",
        role: "vendor",
        status: "active",
        isApproved: true,
        isEmailVerified: true,
      });
      console.log(`Created Vendor 2 User: ${user2.email}`);
    } else {
      console.log(`Found Existing Vendor 2 User: ${user2.email}`);
    }

    let vendor2 = await Vendor.findOne({ userId: user2._id });
    if (!vendor2) {
      vendor2 = await Vendor.create({
        userId: user2._id,
        businessDetails: {
          businessName: "Himalayan Care & Stationery Hub",
          businessType: "Proprietorship",
          gstNumber: "27XYZAB9876C1Z9",
          panNumber: "XYZAB9876C",
          businessEmail: vendor2Email,
          businessPhone: "9812345678",
          yearEstablished: 2021,
          numberOfEmployees: 12,
          categories: [
            "Beauty & Personal Care",
            "School, Office & Stationery",
          ],
          retailChannel: "Online Only",
        },
        sellerDetails: {
          sellerName: "Pooja Sharma",
          sellerEmail: "pooja@himalayancare.com",
          sellerPhone: "9812345678",
          address: "Pulchowk Main Road",
          city: "Lalitpur",
          state: "Bagmati",
          pincode: "44700",
        },
        brandDetails: {
          brandName: "Himalaya Pure",
          brandType: "Personal Care & Stationery",
          trademarkNumber: "TM-432198",
          brandWebsite: "https://himalayancare.com",
          brandLogo:
            "https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?w=500&auto=format&fit=crop&q=60",
        },
        bankDetails: {
          accountHolderName: "Pooja Sharma",
          accountNumber: "98765432109876",
          ifscCode: "NIC009876",
          bankName: "NIC Asia Bank",
          branch: "Pulchowk Branch",
        },
        shippingLocations: {
          warehouseAddress: "Pulchowk Delivery Center, Lalitpur",
          city: "Lalitpur",
          state: "Bagmati",
          pincode: "44700",
        },
        status: "approved",
      });
      console.log(`Created Vendor 2 Record: ${vendor2.businessDetails.businessName}`);
    } else {
      console.log(`Found Existing Vendor 2 Record: ${vendor2.businessDetails.businessName}`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 2: Seed Products for each Category and Subcategory
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- Seeding Products (2 for each category & subcategory) ---");

    let createdCount = 0;
    let updatedCount = 0;

    for (const group of SEED_DATA) {
      const { category, subCategory, items } = group;

      // Assign Grocery & Kitchen, Snacks & Drinks to Vendor 1
      // Assign Beauty & Personal Care, School & Stationery to Vendor 2
      const isVendor1 =
        category === "Grocery & Kitchen" || category === "Snacks & Drinks";
      const assignedVendor = isVendor1 ? vendor1 : vendor2;
      const assignedUser = isVendor1 ? user1 : user2;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const baseSlug = String(item.name)
          .toLowerCase()
          .replace(/[^\w\s-]/g, "")
          .replace(/[\s_-]+/g, "-")
          .replace(/^-+|-+$/g, "");

        const sku = `BM-${category.slice(0, 3).toUpperCase()}-${Math.floor(
          100000 + Math.random() * 900000
        )}`;

        const productData = {
          vendor: assignedVendor._id,
          user: assignedUser._id,
          name: item.name,
          slug: baseSlug,
          description: item.description,
          shortDescription: item.description.slice(0, 120),
          category,
          subCategory,
          supplierName: assignedVendor.businessDetails.businessName,
          brand: item.brand,
          expirationDate: "12/2027",
          price: item.price,
          originalPrice: item.originalPrice,
          discountCategory: "Flat Amount Discount",
          discountValue: item.originalPrice - item.price,
          discount: parseFloat(
            (((item.originalPrice - item.price) / item.originalPrice) * 100).toFixed(2)
          ),
          sku,
          stock: item.stock,
          reorderLevel: 10,
          unit: item.unit,
          inStock: item.stock > 0,
          images: [
            {
              url: item.image,
              publicId: `seed-${baseSlug}`,
              altText: item.name,
            },
          ],
          variants: [
            {
              type: "Standard",
              weightUnit: item.unit.split(" ")[1] || "kg",
              weightValue: item.unit.split(" ")[0] || "1",
              color: "Natural",
              price: item.price,
              sku: `${sku}-STD`,
              stock: item.stock,
            },
          ],
          tags: item.tags,
          status: "Active",
          visibility: {
            isFeatured: i === 0,
            isBestSeller: true,
            isNewArrival: i === 1,
          },
          ratingsAverage: +(4.2 + Math.random() * 0.7).toFixed(1),
          ratingsCount: Math.floor(15 + Math.random() * 85),
          views: 500,
          ordersCount: 120,
          refundsCount: 29,
          conversionRate: 24,
          returnRefundRate: 24,
          isActive: true,
          isDeleted: false,
        };

        const existing = await Product.findOne({
          $or: [{ slug: baseSlug }, { name: item.name }],
        });

        if (existing) {
          await Product.findByIdAndUpdate(existing._id, { ...productData, vendor: assignedVendor._id });
          updatedCount++;
        } else {
          await Product.create(productData);
          createdCount++;
        }
      }
    }

    console.log(
      `\n✅ Seeding Completed! Added ${createdCount} new products, Updated ${updatedCount} products across 35 subcategories and 2 vendors.`
    );
    console.log(`\nVendors created:`);
    console.log(`1. ${vendor1Email} / Password@123 (Annapurna Organics & Superstore)`);
    console.log(`2. ${vendor2Email} / Password@123 (Himalayan Care & Daily Needs)`);

    process.exit(0);
  } catch (error) {
    console.error("Error during seeding:", error);
    process.exit(1);
  }
}

seedDatabase();
