const mongoose = require("mongoose");
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

var schema = mongoose.Schema;

var userSchema = new schema(
  {
    name: { type: String, trim: true, default: null },
    email: { type: String, trim: true, default: null },
    phone_number: { type: String, trim: true, default: null },
    address: { type: String, trim: true, default: null },
    state_id: { type: mongoose.Schema.Types.ObjectId, default: null, ref: 'state' },
    city_id: { type: mongoose.Schema.Types.ObjectId, default: null, ref: 'city' },
    pincode: { type: String, trim: true, default: null },
    franchise_id: { type: mongoose.Schema.Types.ObjectId, default: null, ref: 'franchise' },
    profile_url: { type: String, trim: true, default: null },
    password: { type: String, select: false },
    user_id: { type: String, trim: true, default: null },
    registration_id: { type: String, trim: true, default: null },
    is_from_web: { type: Boolean, default: false },
    is_active: { type: Boolean, default: false },
    is_blocked: { type: Boolean, default: false },
    chat: { type: Boolean, default: true },
    is_business: { type: Boolean, default: false },
    type: { type: Number, required: true, default: 1 },
    /*
      1 for Admin
      2 for Partner
      3 for Employee
      4 for user/ Customer
      5 for Super Admin
      6 for Staff
    */
    registration_type: { type: Number, required: true, default: 1 },
    /*
      1 for normal
      2 for google
      3 for apple
      4 for facebook
      5 for X
    */
    device_token: { type: String, default: null },
    business_info_id: { type: mongoose.Schema.Types.ObjectId, default: null, ref: 'business_info' },
    auth_token: { type: String, default: null },
    created_by_id: { type: mongoose.Schema.Types.ObjectId, default: null, ref: 'user' },
    last_signin: { type: Date, default: null },

    submitted_at: { type: Date, default: null },
    verified_at: { type: Date, default: null },
    documents: { type: [mongoose.Schema.Types.ObjectId], default: [], ref: 'partner_document' },
    verification_status: { type: Number, default: 1 },
    /*
      1 for Pending
      2 for Verified
      3 for Reject
    */
    verification_id: { type: String, default: '' },
    accessible_screens: {
      type: [
        {
          page: { type: String, required: true, trim: true },
          url: { type: String, required: true, trim: true },
        },
      ],
      default: [],
    },

    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
    deleted_at: { type: Date, default: null },
  },
  {
    timestamps: false,
  }
);


userSchema.index({ email: 1, phone_number: 1, deleted_at: 1 }, { unique: true });
userSchema.index({ type: 1 });
userSchema.index({ state_id: 1 });
userSchema.index({ city_id: 1 });
userSchema.index({ franchise_id: 1 });
userSchema.index({ created_by_id: 1 });


userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();

  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
  }
});

userSchema.methods.generateAuthToken = function () {

  // Generate JWT
  const token = jwt.sign(
    { id: this._id, email: this.email, type: this.phone_number },
    process.env.JWT_SECRET,
    // { expiresIn: '1h' } // Token expiration time
  );
  this.last_signin = new Date();
  this.auth_token = token;
  return token;
};


userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};


userSchema.set("toJSON", {
  transform: (doc, ret) => {
    delete ret.password; // Remove password from response
    delete ret.__v; // Remove MongoDB version key
    return ret;
  },
});

module.exports = mongoose.model("user", userSchema);
