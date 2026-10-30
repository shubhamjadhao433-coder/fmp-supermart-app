import pg from 'pg';
import { newDb } from 'pg-mem';
import bcrypt from 'bcryptjs';

const { Pool } = pg;

export interface DBClient {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number }>;
}

let pool: pg.Pool | null = null;
let memDb: any = null;

export async function getDb(): Promise<DBClient> {
  if (process.env.DATABASE_URL) {
    if (!pool) {
      pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
      });
      pool.on('error', (err: any) => console.error('Unexpected PG client error', err));
    }
    return pool;
  }

  // Fallback to high-fidelity in-memory PostgreSQL emulator
  if (!memDb) {
    memDb = newDb();
    
    // Register custom functions
    memDb.public.registerFunction({
      name: 'now',
      implementation: () => new Date(),
    });
    
    // Get adapter that mimics pg Pool interface
    const adapter = memDb.adapters.createPg();
    pool = new adapter.Pool();
  }

  return pool!;
}

// Transaction runner that works across standard pg and pg-mem
export async function withTransaction<T>(callback: (client: DBClient) => Promise<T>): Promise<T> {
  const db = await getDb();
  
  // For standard pool client
  if ('connect' in db && typeof (db as any).connect === 'function') {
    const client = await (db as any).connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  // Fallback direct execution
  await db.query('BEGIN');
  try {
    const result = await callback(db);
    await db.query('COMMIT');
    return result;
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  }
}

let isDbInitialized = false;

export async function initDatabase() {
  if (isDbInitialized) return;
  const db = await getDb();

  const tableCheck = await db.query("SELECT 1 FROM information_schema.tables WHERE table_name = 'users'");
  if (tableCheck.rows.length > 0) {
    await ensureSpecialCredentials(db);
    isDbInitialized = true;
    return;
  }

  // Create tables with proper types and primary keys
  await db.query(`
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      phone VARCHAR(15),
      name VARCHAR(100),
      email VARCHAR(100),
      role VARCHAR(20),
      password_hash VARCHAR(255),
      address TEXT,
      landmark VARCHAR(150),
      city VARCHAR(50),
      pincode VARCHAR(10),
      created_at TIMESTAMP
    );
  `);

  await db.query(`
    CREATE TABLE categories (
      id SERIAL PRIMARY KEY,
      name VARCHAR(50),
      slug VARCHAR(50),
      description TEXT,
      image_url TEXT,
      display_order INT
    );
  `);

  await db.query(`
    CREATE TABLE products (
      id SERIAL PRIMARY KEY,
      category_id INT,
      name VARCHAR(150),
      unit VARCHAR(50),
      price NUMERIC(10, 2),
      mrp NUMERIC(10, 2),
      discount_percent INT,
      stock INT,
      image_url TEXT,
      description TEXT,
      is_active BOOLEAN,
      created_at TIMESTAMP,
      updated_at TIMESTAMP
    );
  `);

  await db.query(`
    CREATE TABLE orders (
      id SERIAL PRIMARY KEY,
      order_number VARCHAR(30),
      customer_id INT,
      customer_name VARCHAR(100),
      customer_phone VARCHAR(15),
      delivery_address TEXT,
      landmark VARCHAR(150),
      pincode VARCHAR(10),
      subtotal NUMERIC(10, 2),
      delivery_fee NUMERIC(10, 2),
      handling_fee NUMERIC(10, 2),
      total_amount NUMERIC(10, 2),
      payment_mode VARCHAR(20),
      status VARCHAR(30),
      delivery_type VARCHAR(30),
      scheduled_date VARCHAR(50),
      time_slot VARCHAR(60),
      rider_id INT,
      rider_name VARCHAR(100),
      rider_phone VARCHAR(15),
      delivery_otp VARCHAR(10),
      otp_expires_at TIMESTAMP,
      otp_attempts INT,
      failure_reason TEXT,
      cod_collected BOOLEAN,
      cod_collected_at TIMESTAMP,
      cod_reconciled BOOLEAN,
      cod_reconciled_at TIMESTAMP,
      created_at TIMESTAMP,
      updated_at TIMESTAMP
    );
  `);

  await db.query(`
    CREATE TABLE order_items (
      id SERIAL PRIMARY KEY,
      order_id INT,
      product_id INT,
      product_name VARCHAR(150),
      unit VARCHAR(50),
      price NUMERIC(10, 2),
      quantity INT,
      total NUMERIC(10, 2),
      image_url TEXT
    );
  `);

  await db.query(`
    CREATE TABLE suppliers (
      id SERIAL PRIMARY KEY,
      name VARCHAR(150),
      contact_person VARCHAR(100),
      phone VARCHAR(20),
      email VARCHAR(100),
      address TEXT,
      city VARCHAR(50),
      gst_number VARCHAR(30),
      created_at TIMESTAMP
    );
  `);

  await db.query(`
    CREATE TABLE purchase_orders (
      id SERIAL PRIMARY KEY,
      po_number VARCHAR(30),
      supplier_id INT,
      supplier_name VARCHAR(150),
      status VARCHAR(30),
      total_amount NUMERIC(10, 2),
      notes TEXT,
      created_at TIMESTAMP,
      received_at TIMESTAMP
    );
  `);

  await db.query(`
    CREATE TABLE purchase_order_items (
      id SERIAL PRIMARY KEY,
      purchase_order_id INT,
      product_id INT,
      product_name VARCHAR(150),
      quantity INT,
      cost_price NUMERIC(10, 2),
      total NUMERIC(10, 2)
    );
  `);

  await db.query(`
    CREATE TABLE inventory_logs (
      id SERIAL PRIMARY KEY,
      product_id INT,
      change_type VARCHAR(50),
      quantity_change INT,
      stock_after INT,
      reference_id VARCHAR(50),
      notes TEXT,
      created_at TIMESTAMP
    );
  `);

  await db.query(`
    CREATE TABLE audit_logs (
      id SERIAL PRIMARY KEY,
      user_id INT,
      user_role VARCHAR(20),
      action VARCHAR(100),
      entity VARCHAR(50),
      entity_id VARCHAR(50),
      details TEXT,
      ip_address VARCHAR(50),
      created_at TIMESTAMP
    );
  `);

  await db.query(`
    CREATE TABLE cod_reconciliations (
      id SERIAL PRIMARY KEY,
      reconciliation_number VARCHAR(30),
      rider_id INT,
      rider_name VARCHAR(100),
      total_amount NUMERIC(10, 2),
      order_count INT,
      order_ids TEXT,
      reconciled_by INT,
      notes TEXT,
      created_at TIMESTAMP
    );
  `);

  await db.query(`
    CREATE TABLE notifications (
      id SERIAL PRIMARY KEY,
      user_id INT,
      title VARCHAR(150),
      message TEXT,
      type VARCHAR(30),
      is_read BOOLEAN,
      order_id INT,
      created_at TIMESTAMP
    );
  `);

  await db.query(`
    CREATE TABLE favorites (
      id SERIAL PRIMARY KEY,
      customer_id INT,
      product_id INT,
      created_at TIMESTAMP
    );
  `);

  await db.query(`
    CREATE TABLE product_reviews (
      id SERIAL PRIMARY KEY,
      product_id INT,
      customer_id INT,
      customer_name VARCHAR(100),
      order_id INT,
      rating INT,
      review_text TEXT,
      status VARCHAR(20),
      created_at TIMESTAMP
    );
  `);

  // Seed default data if users table is empty
  await seedInitialData(db);
  isDbInitialized = true;
}

async function ensureSpecialCredentials(db: DBClient) {
  const adminHash = await bcrypt.hash('test@12345', 10);
  const riderHash = await bcrypt.hash('Shubham@7', 10);

  const adminCheck = await db.query("SELECT id FROM users WHERE phone = '9699925206' AND role = 'admin'");
  if (adminCheck.rows.length === 0) {
    await db.query(
      `INSERT INTO users (phone, name, email, role, password_hash, address, landmark, city, pincode)
       VALUES ('9699925206', 'FMP Supermart Admin', 'admin@fmpsupermart.in', 'admin', $1, 'Central Warehouse, Shivaji Chowk', 'Near Bus Stand', 'Karanja Lad', '444105')`,
      [adminHash]
    );
  } else {
    await db.query("UPDATE users SET password_hash = $1 WHERE id = $2", [adminHash, adminCheck.rows[0].id]);
  }

  const riderCheck = await db.query("SELECT id FROM users WHERE phone = '9699925206' AND role = 'rider'");
  if (riderCheck.rows.length === 0) {
    await db.query(
      `INSERT INTO users (phone, name, email, role, password_hash, address, landmark, city, pincode)
       VALUES ('9699925206', 'Shubham (Delivery Partner)', 'shubham.rider@fmpsupermart.in', 'rider', $1, 'Station Road, Karanja Lad', 'Opposite Railway Gate', 'Karanja Lad', '444105')`,
      [riderHash]
    );
  } else {
    await db.query("UPDATE users SET password_hash = $1 WHERE id = $2", [riderHash, riderCheck.rows[0].id]);
  }
}

async function seedInitialData(db: DBClient) {
  const usersCheck = await db.query('SELECT COUNT(*) as count FROM users');
  const userCount = parseInt(usersCheck.rows[0]?.count || '0', 10);
  if (userCount > 0) {
    await ensureSpecialCredentials(db);
    return;
  }

  console.log('Seeding initial users, categories, products, and suppliers for Karanja Lad...');

  // 1. Seed Users
  const adminHash = await bcrypt.hash('AdminPassword@123', 10);
  const riderHash = await bcrypt.hash('RiderPassword@123', 10);
  const customerHash = await bcrypt.hash('CustomerPassword@123', 10);

  await db.query(
    `INSERT INTO users (phone, name, email, role, password_hash, address, landmark, city, pincode)
     VALUES 
      ($1, $2, $3, 'admin', $4, $5, $6, 'Karanja Lad', '444105'),
      ($7, $8, $9, 'rider', $10, $11, $12, 'Karanja Lad', '444105'),
      ($13, $14, $15, 'customer', $16, $17, $18, 'Karanja Lad', '444105')`,
    [
      '9876543210', 'FMP Supermart Admin', 'admin@fmpsupermart.in', adminHash, 'Central Warehouse, Shivaji Chowk', 'Near Bus Stand',
      '9898989898', 'Sunil Rathod (Rider)', 'sunil.rider@fmpsupermart.in', riderHash, 'Station Road, Karanja Lad', 'Opposite Railway Gate',
      '9123456780', 'Rahul Deshmukh', 'rahul.karanja@gmail.com', customerHash, 'Plot 14, Anand Nagar, Guru Mandir Marg', 'Near Guru Mandir'
    ]
  );

  // Ensure 9699925206 admin and rider accounts
  await ensureSpecialCredentials(db);

  // 2. Seed Categories
  const categories = [
    { name: 'Grocery', slug: 'grocery', desc: 'Flours, Grains, Pulses, Cooking Oils & Masalas', order: 1, img: 'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=400&q=80' },
    { name: 'Fruits', slug: 'fruits', desc: 'Farm fresh regional & seasonal fruits', order: 2, img: 'https://images.unsplash.com/photo-1619566636858-adf3ef46400b?auto=format&fit=crop&w=400&q=80' },
    { name: 'Vegetables', slug: 'vegetables', desc: 'Daily harvest fresh vegetables from Karanja Mandi', order: 3, img: 'https://images.unsplash.com/photo-1597362925123-77861d3fbac7?auto=format&fit=crop&w=400&q=80' },
    { name: 'Dairy', slug: 'dairy', desc: 'Fresh Cow Milk, Curd, Paneer, Amul Butter & Ghee', order: 4, img: 'https://images.unsplash.com/photo-1628088062854-d1870b4553da?auto=format&fit=crop&w=400&q=80' },
    { name: 'Snacks', slug: 'snacks', desc: 'Namkeen, Haldiram Bhujia, Biscuits & Local Poha', order: 5, img: 'https://images.unsplash.com/photo-1621996346565-e3d5d628169e?auto=format&fit=crop&w=400&q=80' },
    { name: 'Beverages', slug: 'beverages', desc: 'Premium Tea, Coffee, Juices & Refreshing Drinks', order: 6, img: 'https://images.unsplash.com/photo-1544787219-7f47ccb76574?auto=format&fit=crop&w=400&q=80' },
    { name: 'Household', slug: 'household', desc: 'Detergents, Surface Cleaners & Daily Home Essentials', order: 7, img: 'https://images.unsplash.com/photo-1583947215259-38e31be8751f?auto=format&fit=crop&w=400&q=80' }
  ];

  for (const cat of categories) {
    await db.query(
      `INSERT INTO categories (name, slug, description, image_url, display_order)
       VALUES ($1, $2, $3, $4, $5)`,
      [cat.name, cat.slug, cat.desc, cat.img, cat.order]
    );
  }

  // 3. Seed Products across categories
  const products = [
    // Grocery
    { cat: 'grocery', name: 'Aashirvaad Shuddh Chakki Atta', unit: '5 kg', price: 235, mrp: 265, disc: 11, stock: 45, img: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=400&q=80', desc: '100% whole wheat flour, soft rotis guaranteed.' },
    { cat: 'grocery', name: 'Fortune Sunlite Refined Sunflower Oil', unit: '1 L Pouch', price: 138, mrp: 165, disc: 16, stock: 60, img: 'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?auto=format&fit=crop&w=400&q=80', desc: 'Light, healthy cooking oil with Vitamin A & D.' },
    { cat: 'grocery', name: 'Kolam Wada Rice (Premium Quality)', unit: '5 kg Bag', price: 340, mrp: 390, disc: 12, stock: 35, img: 'https://images.unsplash.com/photo-1586201375761-83865001e31c?auto=format&fit=crop&w=400&q=80', desc: 'Aromatic short grain rice from local Vidarbha farmers.' },
    { cat: 'grocery', name: 'Tata Sampann Unpolished Toor Dal', unit: '1 kg', price: 165, mrp: 185, disc: 10, stock: 50, img: 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?auto=format&fit=crop&w=400&q=80', desc: 'Rich in natural protein, unpolished toor dal.' },
    { cat: 'grocery', name: 'Tata Salt Vacuum Evaporated Iodized Salt', unit: '1 kg', price: 28, mrp: 30, disc: 6, stock: 120, img: 'https://images.unsplash.com/photo-1518110925495-5fe2fda0442c?auto=format&fit=crop&w=400&q=80', desc: 'Desh Ka Namak with essential iodine.' },
    { cat: 'grocery', name: 'Everest Turmeric Powder (Haldi)', unit: '200 g', price: 42, mrp: 48, disc: 12, stock: 80, img: 'https://images.unsplash.com/photo-1615485290382-441e4d049cb5?auto=format&fit=crop&w=400&q=80', desc: 'Pure aromatic turmeric with high curcumin content.' },

    // Fruits
    { cat: 'fruits', name: 'Fresh Karanja Farm Bananas', unit: '1 Dozen', price: 50, mrp: 60, disc: 16, stock: 40, img: 'https://images.unsplash.com/photo-1571771894821-ce9b6c11b08e?auto=format&fit=crop&w=400&q=80', desc: 'Sweet, ripe and naturally ripened bananas.' },
    { cat: 'fruits', name: 'Nagpur Sweet Oranges (Santra)', unit: '1 kg', price: 75, mrp: 90, disc: 16, stock: 30, img: 'https://images.unsplash.com/photo-1547514701-42782101795e?auto=format&fit=crop&w=400&q=80', desc: 'Juicy, sweet and vitamin C rich Vidarbha santra.' },
    { cat: 'fruits', name: 'Shimla Royal Red Apples', unit: '1 kg (approx 4-5 pcs)', price: 175, mrp: 210, disc: 16, stock: 25, img: 'https://images.unsplash.com/photo-1560806887-1e4cd0b6cbd6?auto=format&fit=crop&w=400&q=80', desc: 'Crisp, sweet handpicked Himachal apples.' },
    { cat: 'fruits', name: 'Fresh Anar (Pomegranate)', unit: '1 kg', price: 160, mrp: 190, disc: 15, stock: 20, img: 'https://images.unsplash.com/photo-1615485290382-441e4d049cb5?auto=format&fit=crop&w=400&q=80', desc: 'Ruby red seeds loaded with antioxidants.' },

    // Vegetables
    { cat: 'vegetables', name: 'Nashik Fresh Red Onions (Kanda)', unit: '2 kg', price: 65, mrp: 80, disc: 18, stock: 85, img: 'https://images.unsplash.com/photo-1508747703725-719777637510?auto=format&fit=crop&w=400&q=80', desc: 'Fresh crunchy red onions, essential for Indian tadka.' },
    { cat: 'vegetables', name: 'Fresh Desi Potatoes (Batata)', unit: '2 kg', price: 55, mrp: 70, disc: 21, stock: 90, img: 'https://images.unsplash.com/photo-1518977676601-b53f82aba655?auto=format&fit=crop&w=400&q=80', desc: 'Firm, clean golden potatoes.' },
    { cat: 'vegetables', name: 'Local Hybrid Tomatoes (Tamatar)', unit: '1 kg', price: 35, mrp: 45, disc: 22, stock: 65, img: 'https://images.unsplash.com/photo-1592924357228-91a4daadcfea?auto=format&fit=crop&w=400&q=80', desc: 'Juicy, farm fresh red tomatoes.' },
    { cat: 'vegetables', name: 'Fresh Tender Bhendi (Ladyfinger)', unit: '500 g', price: 28, mrp: 35, disc: 20, stock: 35, img: 'https://images.unsplash.com/photo-1425543103986-22abb7d7e8d2?auto=format&fit=crop&w=400&q=80', desc: 'Handpicked tender okra without fibers.' },
    { cat: 'vegetables', name: 'Fresh Spicy Green Chillies (Mirchi)', unit: '250 g', price: 18, mrp: 25, disc: 28, stock: 40, img: 'https://images.unsplash.com/photo-1588252303782-cb80119abd6d?auto=format&fit=crop&w=400&q=80', desc: 'Fiery green chillies for authentic spicy flavor.' },

    // Dairy
    { cat: 'dairy', name: 'Amul Taaza Homogenised Toned Milk', unit: '1 L Tetra Pack', price: 74, mrp: 76, disc: 2, stock: 40, img: 'https://images.unsplash.com/photo-1550583724-b2692b85b150?auto=format&fit=crop&w=400&q=80', desc: 'Fresh pasteurised toned milk with 3.0% fat.' },
    { cat: 'dairy', name: 'Amul Pasteurised Salted Butter', unit: '100 g', price: 58, mrp: 60, disc: 3, stock: 50, img: 'https://images.unsplash.com/photo-1589985270826-4b7bb135bc9d?auto=format&fit=crop&w=400&q=80', desc: 'Utterly butterly delicious butter.' },
    { cat: 'dairy', name: 'Gowardhan Fresh Paneer Block', unit: '200 g', price: 95, mrp: 105, disc: 9, stock: 30, img: 'https://images.unsplash.com/photo-1631451095765-2c91616fc9e6?auto=format&fit=crop&w=400&q=80', desc: 'Soft and melt-in-the-mouth paneer made from pure cow milk.' },
    { cat: 'dairy', name: 'Mother Dairy Classic Dahi (Curd)', unit: '400 g Cup', price: 38, mrp: 40, disc: 5, stock: 35, img: 'https://images.unsplash.com/photo-1571212515416-fef01fc43637?auto=format&fit=crop&w=400&q=80', desc: 'Thick, creamy and naturally set dahi.' },
    { cat: 'dairy', name: 'Amul Pure Cow Ghee Jar', unit: '500 ml', price: 320, mrp: 350, disc: 8, stock: 25, img: 'https://images.unsplash.com/photo-1589985270826-4b7bb135bc9d?auto=format&fit=crop&w=400&q=80', desc: 'Traditional golden cow ghee with rich granular texture.' },

    // Snacks
    { cat: 'snacks', name: 'Haldiram Nagpur Aloo Bhujia', unit: '200 g', price: 55, mrp: 60, disc: 8, stock: 70, img: 'https://images.unsplash.com/photo-1566478989037-eec170784d0b?auto=format&fit=crop&w=400&q=80', desc: 'Crispy mint and spicy potato extruded snack.' },
    { cat: 'snacks', name: 'Vidarbha Special Thick Poha', unit: '1 kg', price: 52, mrp: 65, disc: 20, stock: 60, img: 'https://images.unsplash.com/photo-1589301760014-d929f3979dbc?auto=format&fit=crop&w=400&q=80', desc: 'Premium thick poha for hearty breakfast kanda poha.' },
    { cat: 'snacks', name: 'Parle-G Original Gluco Biscuits Family Pack', unit: '800 g', price: 80, mrp: 90, disc: 11, stock: 80, img: 'https://images.unsplash.com/photo-1558961363-fa8fdf82db35?auto=format&fit=crop&w=400&q=80', desc: 'India’s most loved glucose biscuit with tea.' },
    { cat: 'snacks', name: 'Britannia Good Day Butter Cookies', unit: '200 g', price: 40, mrp: 45, disc: 11, stock: 65, img: 'https://images.unsplash.com/photo-1590080875515-8a3a8dc5735e?auto=format&fit=crop&w=400&q=80', desc: 'Rich buttery cookies with a pleasant crunch.' },

    // Beverages
    { cat: 'beverages', name: 'Society Premium Tea Leaf Powder', unit: '500 g', price: 260, mrp: 295, disc: 11, stock: 45, img: 'https://images.unsplash.com/photo-1576092768241-dec231879fc3?auto=format&fit=crop&w=400&q=80', desc: 'Rich aroma and strong taste for morning freshness.' },
    { cat: 'beverages', name: 'Bru Instant Coffee Jar', unit: '100 g', price: 190, mrp: 215, disc: 11, stock: 35, img: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?auto=format&fit=crop&w=400&q=80', desc: 'Finest robusta and arabica blend for aromatic coffee.' },
    { cat: 'beverages', name: 'Real Fruit Power Mixed Fruit Juice', unit: '1 L', price: 110, mrp: 130, disc: 15, stock: 40, img: 'https://images.unsplash.com/photo-1621506289937-a8e4df240d0b?auto=format&fit=crop&w=400&q=80', desc: 'Blend of 9 wholesome fruits without added preservatives.' },

    // Household
    { cat: 'household', name: 'Surf Excel Quick Wash Detergent Powder', unit: '1 kg', price: 145, mrp: 160, disc: 9, stock: 55, img: 'https://images.unsplash.com/photo-1585421514738-01798e348b17?auto=format&fit=crop&w=400&q=80', desc: 'Faster stain removal in machines and bucket wash.' },
    { cat: 'household', name: 'Vim Lemon Dishwash Bar Combo', unit: '3 x 150 g', price: 45, mrp: 54, disc: 16, stock: 80, img: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?auto=format&fit=crop&w=400&q=80', desc: 'Power of 100 lemons cuts through stubborn oil grease.' },
    { cat: 'household', name: 'Dettol Original Germ Protection Soap', unit: '4 x 125 g Pack', price: 185, mrp: 210, disc: 11, stock: 60, img: 'https://images.unsplash.com/photo-1607613009820-a29f7bb81c04?auto=format&fit=crop&w=400&q=80', desc: 'Trusted antibacterial soap protection for entire family.' },
    { cat: 'household', name: 'Lizol Floral Floor Cleaner Disinfectant', unit: '1 L Bottle', price: 195, mrp: 220, disc: 11, stock: 40, img: 'https://images.unsplash.com/photo-1583947215259-38e31be8751f?auto=format&fit=crop&w=400&q=80', desc: 'Kills 99.9% germs, leaves long lasting floral fragrance.' }
  ];

  for (const p of products) {
    const catRes = await db.query('SELECT id FROM categories WHERE slug = $1', [p.cat]);
    const catId = catRes.rows[0]?.id || 1;
    await db.query(
      `INSERT INTO products (category_id, name, unit, price, mrp, discount_percent, stock, image_url, description, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE)`,
      [catId, p.name, p.unit, p.price, p.mrp, p.disc, p.stock, p.img, p.desc]
    );
  }

  // 4. Seed Suppliers
  await db.query(`
    INSERT INTO suppliers (name, contact_person, phone, email, address, city, gst_number)
    VALUES 
      ('Vidarbha Agro & Grains Mart', 'Gajanan Patil', '9422113344', 'vidarbha.agro@karanjamandi.in', 'Shop 12, Krishi Utpanna Bazar Samiti (APMC), Karanja Lad', 'Karanja Lad', '27AABCV1234F1Z1'),
      ('Washim Dairy & Amul Agency', 'Nitin Sharma', '9422556677', 'amulwashim@gmail.com', 'Near Bus Stand, Station Road, Karanja Lad', 'Karanja Lad', '27BCCDE5678G2Z2'),
      ('Karanja FMCG Wholesale Depot', 'Rajendra Bhutada', '9822334455', 'bhutada.wholesale@gmail.com', 'Gandhi Chowk, Main Market, Karanja Lad', 'Karanja Lad', '27AABCR9988H1Z5');
  `);

  // 5. Seed Initial Favorites & Reviews
  await db.query(`
    INSERT INTO favorites (customer_id, product_id)
    VALUES (3, 1), (3, 3), (3, 7), (3, 11)
  `);

  await db.query(`
    INSERT INTO product_reviews (product_id, customer_id, customer_name, rating, review_text, status)
    VALUES 
      (1, 3, 'Rahul Deshmukh', 5, 'Best quality wheat flour in Karanja Lad! Rotis come out very soft.', 'approved'),
      (2, 3, 'Rahul Deshmukh', 4, 'Good pure sunflower oil for daily Indian cooking.', 'approved'),
      (7, 3, 'Rahul Deshmukh', 5, 'Bananas were very fresh and naturally sweet. Prompt delivery!', 'approved')
  `);

  console.log('Database seeded successfully for Karanja Lad!');
}
