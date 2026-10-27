require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const connectDB = require('./src/config/db');
const categoryRoutes = require('./src/routes/categoryRoutes');
const adminRoutes = require('./src/routes/adminRoutes');
const onboardingRoutes = require('./routes/onboardingRoutes');

// Initialize Express App
const app = express();

// Connect to Database
connectDB();

// Global Middleware
app.use(helmet()); // Security HTTP headers
app.use(cors({ origin: process.env.CLIENT_URL, credentials: true })); // Cross-Origin Resource Sharing
app.use(express.json({ limit: '10kb' })); // Body parser, reading data from body into req.body
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Development logging
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// Routes (Placeholders to be built out)
app.use('/api/auth', require('./src/routes/authRoutes'));
app.use('/api/stores', require('./src/routes/storeRoutes'));
app.use('/api/products', require('./src/routes/productRoutes'));
app.use('/api/categories', require('./src/routes/categoryRoutes'));
app.use('/api/feedback', require('./src/routes/feedbackRoutes'));
app.use('/api/guide', require('./src/routes/guideRoutes'));
app.use('/api/onboarding', require('./src/routes/onboardingRoutes'));
app.use('/api/admin', adminRoutes);
app.use('/api/categories', categoryRoutes);
// Base Route
app.get('/', (req, res) => {
  res.status(200).json({ message: 'Vendira API is running successfully!' });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    status: 'error',
    message: err.message || 'Internal Server Error'
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
});
