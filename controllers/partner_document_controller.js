const PartnerDocument = require('../models/partner_document');
const User = require('../models/user');
const { validationResult } = require('express-validator');
const { applyPagination } = require('../utils/pagination');
const { getVerificationId } = require('../helper/id_generator');
const { getDocuementStatus } = require('../validator/document_validator');
const { fieldLabel } = require('../utils/field_labels');
const {
  partnerDocumentFieldsAfterImageUpload,
  applyPartnerUserStatusAfterDocumentUpload,
} = require('../utils/partner_document_status');
const { safeNotifyPartnerVerificationUpdated } = require('../src/modules/notifications/services/domainHooks');

const getAll = async (req, res) => {

  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const verification_status = parseInt(req.query.verification_status);

    const filter = {
      deleted_at: null,
      document_images: { $exists: true, $ne: [], $not: { $size: 0 } },
      ...(req.query.verification_status && { verification_status: verification_status }),
    };

    if (req.query.verification_id) {
      filter.verification_id = { $regex: new RegExp(req.query.verification_id, "i") };
    }

    const sort = { created_at: -1 };

    const projection = { password: 0, auth_token: 0 };
    const { data: documents, totalCount, totalPages, currentPage } = await applyPagination(
      PartnerDocument,
      filter,
      page,
      limit,
      sort,
      projection,
    );

    const populateDocuments = documents.map(() => {
      return [
        { path: "partner_id" },
        { path: "document_id" },
      ];
    });

    const populatedDocuments = await Promise.all(
      documents.map((document, index) =>
        PartnerDocument.populate(document, populateDocuments[index])
      )
    );

    const processedDocuments = populatedDocuments.map((document) => {
      const { ...rest } = document;

      return {
        ...rest,
        partner_id: document.partner_id?._id,
        submitter_name: document.partner_id?.name,
        registration_id: document.partner_id?.registration_id,

        document_id: document.document_id?._id,
        document_name: document.document_id?.name,
      };
    });


    res.status(200).json({
      success: true,
      status: 200,
      message: "PartnerDocument list fetched successfully.",
      totalItems: totalCount,
      totalPages,
      currentPage,
      records: processedDocuments,
    });
  } catch (err) {
    console.log("Error is ", err.message);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.'
    });
  }
};
const create = async (req, res) => {
  try {
    const {
      partner_id,
      document_id,
      document_images,
      verification_status,
    } = req.body;

    const newDocuments = new PartnerDocument({
      partner_id,
      document_id,
      document_images,
      verification_status,
    });

    await newDocuments.save();
    return res.status(200).json({
      success: true,
      status: 200,
      message: 'Document uploaded successfully.',
    });
  } catch (error) {
    console.error('Error creating Partner Document:', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.'
    });
  }
};
const createMultiple = async (listOfDocument) => {
  try {

    const result = await PartnerDocument.insertMany(listOfDocument, { ordered: false });

    return {
      success: true,
      status: 200,
      documents: result,
      message: `${result.length} Document uploaded successfully.`,
    };
  } catch (error) {
    console.error('Error creating Partner Document:', error.message);
    return {
      success: false,
      status: 500,
      message: 'Internal server error.'
    };
  }
};
const updateDocumentStatus = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      status: 400,
      errors: errors.array()
    });
  }

  const { id } = req.params;
  const incomingStatus = req.body.status ?? req.body.verification_status;
  const rejectionReasonInput = req.body.rejection_reason ?? req.body.rejected_reasone;
  try {
    const partnerDocument = await PartnerDocument.findById(id);

    if (!partnerDocument) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'Document not found'
      });
    }
    let status = incomingStatus;
    if (typeof status === 'string') {
      const normalizedStatus = status.trim().toLowerCase();
      if (normalizedStatus === 'accept') status = 2;
      else if (normalizedStatus === 'reject') status = 3;
    }
    const numericStatus = Number(status);
    if (![2, 3].includes(numericStatus)) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'status must be accept/reject or 2/3.',
      });
    }

    if (numericStatus === 3 && (!rejectionReasonInput || String(rejectionReasonInput).trim() === '')) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: `${fieldLabel('rejection_reason')} is required when status is reject.`,
      });
    }

    partnerDocument.verification_status = numericStatus;
    partnerDocument.rejection_reason = numericStatus === 3 ? String(rejectionReasonInput).trim() : '';
    partnerDocument.rejected_reasone = numericStatus === 3 ? String(rejectionReasonInput).trim() : '';
    await partnerDocument.save();

    let isVerified = true;

    const populatedPartnerDocument = await PartnerDocument.find({ partner_id: partnerDocument.partner_id }).populate([
      { path: "document_id" },
    ]).lean();

    for (const document of populatedPartnerDocument) {
      if (document.verification_status !== 2 && document.document_id.is_optional === false) {
        isVerified = false;
        break;
      }
    }

    const user = await User.findById({ _id: partnerDocument.partner_id });
    const previousVerificationStatus = Number(user.verification_status);

    if (numericStatus === 2) {
      if (isVerified === true) {
        user.verification_id = await getVerificationId();
        user.verified_at = Date.now();
        user.verification_status = numericStatus;
      } else {
        user.verification_status = getDocuementStatus(populatedPartnerDocument);
      }
    } else {
      user.verification_status = getDocuementStatus(populatedPartnerDocument);
    }

    user.is_active = user.verification_status === 2;

    await user.save();

    const nextVerificationStatus = Number(user.verification_status);
    if (
      nextVerificationStatus !== previousVerificationStatus &&
      [2, 3].includes(nextVerificationStatus)
    ) {
      void safeNotifyPartnerVerificationUpdated({
        partnerUserId: user._id,
        verificationStatus: nextVerificationStatus,
        actorUserId: req.user?.id || req.user?._id || null,
      });
    }

    res.status(200).json({
      success: true,
      status: 200,
      message: 'Document status updated successfully',
    });
  } catch (error) {
    console.error('Error updating Partner Document:', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.'
    });
  }
};
const updateDocument = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      status: 400,
      errors: errors.array()
    });
  }

  const { id } = req.params;
  const image_url = req.body.image_url;

  try {
    const partnerDocument = await PartnerDocument.findById(id);

    if (!partnerDocument) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'Document not found'
      });
    }
    const user = await User.findById(partnerDocument.partner_id);
    if (!user) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'Partner not found',
      });
    }

    partnerDocument.document_image = image_url;
    Object.assign(
      partnerDocument,
      partnerDocumentFieldsAfterImageUpload(user.verification_status)
    );
    await partnerDocument.save();

    if (applyPartnerUserStatusAfterDocumentUpload(user)) {
      await user.save();
    }

    res.status(200).json({
      success: true,
      status: 200,
      message: 'Document status updated successfully',
    });
  } catch (error) {
    console.error('Error updating Partner Document:', error);
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
    const partnerDocument = await PartnerDocument.findById(id);

    if (!partnerDocument) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'Document not found'
      });
    }

    const populatedPartnerDocument = await PartnerDocument.findById(id).populate([
      { path: "partner_id" },
      { path: "document_id" },
    ]).lean();

    const response = {
      ...populatedPartnerDocument,

      partner_id: populatedPartnerDocument.partner_id._id,
      partner_info: populatedPartnerDocument.partner_id,

      document_id: populatedPartnerDocument.document_id._id,
      document_info: populatedPartnerDocument.document_id,
    };


    res.status(200).json({
      success: true,
      status: 200,
      message: 'Document fetched successfully',
      record: response,
    });
  } catch (error) {
    console.error('Error fetching PartnerDocument:', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.'
    });
  }
};
const deleteDocument = async (req, res) => {
  const { id } = req.params;

  try {
    const partnerDocument = await PartnerDocument.findById(id);

    if (!partnerDocument) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'Document not found'
      });
    }

    if (partnerDocument.document_image.length === 0) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Document is already deleted'
      });
    }

    partnerDocument.document_image = '';
    partnerDocument.verification_status = 1;
    await partnerDocument.save();

    const populatedPartnerDocument = await PartnerDocument.find({ partner_id: partnerDocument.partner_id }).populate([
      { path: "document_id" },
    ]).lean();


    const user = await User.findById({ _id: partnerDocument.partner_id });

    const statusResponse = getDocuementStatus(populatedPartnerDocument);
    console.log("statusResponse:", statusResponse)
    if (statusResponse !== undefined) {
      user.verified_at = null;
      user.verification_status = statusResponse;
      user.verification_id = '';
      user.is_active = false;
      await user.save();
    }

    res.status(200).json({
      success: true,
      status: 200,
      message: 'Document deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting PartnerDocument:', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.'
    });
  }
};
const getPartnerDocumentList = async (partnerId) => {
  try {
    const documents = await PartnerDocument.find({ partner_id: partnerId, deleted_at: null });
    const populateDocuments = documents.map(() => {
      return [
        { path: "document_id" },
      ];
    });
    const populatedDocuments = await Promise.all(
      documents.map((document, index) =>
        PartnerDocument.populate(document, populateDocuments[index])
      )
    );

    const processedDocuments = populatedDocuments.map((document) => {
      return {
        ...document.toObject(),
        document_id: document.document_id._id,
        name: document.document_id.name,
        is_optional: document.document_id.is_optional,
      };
    });
    return processedDocuments;
  } catch (err) {
    return [];
  }
};
module.exports = { getAll, create, getById, deleteDocument, updateDocumentStatus, updateDocument, createMultiple, getPartnerDocumentList };
