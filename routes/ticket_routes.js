const express = require('express');
const router = express.Router();
const {getAll, create,update,updateTicketStatus,  getById,  deleteTicket,} = require('../controllers/ticket_controller');
const authMiddleware = require('../middleware/auth_middleware');
const {createTicketMiddleware, updateTicketMiddleware} = require('../middleware/ticket_middleware');




router.post('/create', createTicketMiddleware, create);
router.get('/getAll', authMiddleware, getAll);
router.get('/get/:id', authMiddleware, getById);
// router.put('/update/:id',authMiddleware,updateUserMiddleware, update);
router.put('/updateTicketStatus/:id',authMiddleware,updateTicketMiddleware, updateTicketStatus);
router.delete('/delete/:id',authMiddleware, deleteTicket);


module.exports = router;