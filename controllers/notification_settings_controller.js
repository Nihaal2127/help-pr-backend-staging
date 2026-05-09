const NotificationSetting = require('../models/notification_settings');
const { validationResult } = require('express-validator');

const update = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      status: 400,
      errors: errors.array()
    });
  }

  const { id } = req.params;
  const updateData = req.body;

  try {
    const notificationSettings = await NotificationSetting.findById(id);

    if (!notificationSettings) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'Notification Setting not found'
      });
    }


    Object.keys(updateData).forEach((key) => {
      notificationSettings[key] = updateData[key];
    });

    await notificationSettings.save();

    res.status(200).json({
      success: true,
      status: 200,
      message: 'Notification Setting updated successfully',
    });
  } catch (error) {
    console.error('Error updating Notification Setting:', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.'
    });
  }
};
const getById = async (req, res) => {
  const { id } = req.params;
  try {

    let notificationSetting = await NotificationSetting.findOne({ user_id: id }).lean();

    if (!notificationSetting) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'Notification Setting not found'
      });
    }

    return res.status(200).json({
      success: true,
      status: 200,
      message: 'Notification Setting fetched successfully',
      record: notificationSetting,
    });
  } catch (error) {
    console.error('Error fetching NotificationSetting:', error);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.'
    });
  }
};
module.exports = { update, getById };
