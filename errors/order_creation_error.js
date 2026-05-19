class OrderCreationError extends Error {
  constructor(message, status = 409) {
    super(message);
    this.name = "OrderCreationError";
    this.status = status;
  }
}

module.exports = { OrderCreationError };
