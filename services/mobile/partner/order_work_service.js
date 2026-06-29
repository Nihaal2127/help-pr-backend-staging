const OrderService = require('../../../models/order_services');
const { loadPartnerOrder } = require('../shared/order_access_helpers');
const { handleImageUpload } = require('../../../helper/image_uploader');
const { getUploadType } = require('../../../enum/upload_type_enum');
const {
  ORDER_STATUS_IN_PROGRESS,
  ORDER_STATUS_COMPLETED,
  ORDER_STATUS_CANCELLED,
  ORDER_STATUS_REFUNDED,
  touchOrderStatusInfo,
} = require('../../../enum/order_status_enum');
const {
  PARTNER_WORK_STATUS_IN_PROGRESS,
  PARTNER_WORK_STATUS_COMPLETED,
  normalizePartnerWorkStatus,
  canTransitionPartnerWorkStatus,
  touchPartnerWorkStatusInfo,
} = require('../../../enum/partner_work_status_enum');
const { assertOrderCanBeMarkedCompleted } = require('../../order_completion_validation');
const { loadOrderDetailLean } = require('../../order_detail_service');
const { embedOrderDetailForeignKeys } = require('../../../utils/list_aggregation');
const { stripAdminDescriptionForPublicApi } = require('../../../utils/admin_description_access');
const { attachPartnerOrderSummary } = require('../../../utils/partner_order_summary');
const {
  MIN_IMAGES,
  MAX_IMAGES,
  MAX_DESCRIPTION_LENGTH,
  assertOrderPostLinkPreconditions,
  createOrderPostFromUrls,
} = require('../../partner_post_common_service');

const { fail, ok } = require('../../../utils/mobile_service_result');

const TERMINAL_ORDER_STATUSES = new Set([
  ORDER_STATUS_COMPLETED,
  ORDER_STATUS_CANCELLED,
  ORDER_STATUS_REFUNDED,
]);

const parsePublishAsPost = (raw) => {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return false;
  }
  const normalized = String(raw).trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
};

const uploadWorkProofImages = async (files) => {
  const uploadType = getUploadType(6);
  const urls = [];

  for (const file of files) {
    const url = await handleImageUpload(file, uploadType, true, null);
    urls.push(url);
  }

  return urls;
};

const updatePartnerWorkStatus = async (partnerId, orderId, body) => {
  try {
    const nextStatus = normalizePartnerWorkStatus(body?.partner_work_status);
    if (nextStatus !== PARTNER_WORK_STATUS_IN_PROGRESS) {
      return fail(
        409,
        'Partners can only set partner_work_status to in-progress via this endpoint.'
      );
    }

    const loaded = await loadPartnerOrder(partnerId, orderId);
    if (!loaded.ok) return loaded;

    const order = loaded.data.order;

    if (TERMINAL_ORDER_STATUSES.has(order.order_status)) {
      return fail(409, `Order is already ${order.order_status}.`);
    }

    if (order.order_status !== ORDER_STATUS_IN_PROGRESS) {
      return fail(409, 'Work can only be started on in-progress orders.');
    }

    const currentWorkStatus = order.partner_work_status || 'pending';
    if (!canTransitionPartnerWorkStatus(currentWorkStatus, nextStatus)) {
      return fail(
        409,
        `Cannot change partner_work_status from "${currentWorkStatus}" to "${nextStatus}".`
      );
    }

    order.partner_work_status = nextStatus;
    touchPartnerWorkStatusInfo(order, nextStatus, partnerId, 'partner');
    order.updated_at = new Date();
    await order.save();

    const record = await loadOrderDetailLean(order._id);
    return ok(200, {
      message: 'Partner work status updated successfully.',
      record: stripAdminDescriptionForPublicApi(
        attachPartnerOrderSummary(embedOrderDetailForeignKeys(record))
      ),
    });
  } catch (err) {
    console.error('mobile partner update work status', err.message);
    return fail(500, 'Internal server error.');
  }
};

const completePartnerOrderWork = async (partnerId, orderId, body, files) => {
  try {
    const imageFiles = Array.isArray(files) ? files : [];
    if (imageFiles.length < MIN_IMAGES || imageFiles.length > MAX_IMAGES) {
      return fail(400, `Provide between ${MIN_IMAGES} and ${MAX_IMAGES} proof images.`);
    }

    const loaded = await loadPartnerOrder(partnerId, orderId);
    if (!loaded.ok) return loaded;

    const order = loaded.data.order;

    if (order.order_status === ORDER_STATUS_COMPLETED) {
      return fail(409, 'Order is already completed.');
    }

    if (
      order.order_status === ORDER_STATUS_CANCELLED ||
      order.order_status === ORDER_STATUS_REFUNDED
    ) {
      return fail(409, `Order is ${order.order_status} and cannot be completed.`);
    }

    if (order.order_status !== ORDER_STATUS_IN_PROGRESS) {
      return fail(409, 'Only in-progress orders can be completed.');
    }

    const currentWorkStatus = order.partner_work_status || 'pending';
    if (currentWorkStatus !== PARTNER_WORK_STATUS_IN_PROGRESS) {
      return fail(
        409,
        'Start work (partner_work_status in-progress) before marking the order complete.'
      );
    }

    const completionCheck = await assertOrderCanBeMarkedCompleted(order);
    if (!completionCheck.ok) {
      return fail(completionCheck.status, completionCheck.message, {
        breakdown: completionCheck.breakdown,
      });
    }

    const publishAsPost = parsePublishAsPost(body?.publish_as_post);
    const description = String(
      body?.post_description ?? body?.description ?? body?.work_completion_description ?? ''
    ).trim();

    if (publishAsPost && !description) {
      return fail(
        400,
        'description (or post_description) is required when publish_as_post is true.'
      );
    }

    if (description.length > MAX_DESCRIPTION_LENGTH) {
      return fail(
        400,
        `Description must be at most ${MAX_DESCRIPTION_LENGTH} characters.`
      );
    }

    if (publishAsPost) {
      const postPrecheck = await assertOrderPostLinkPreconditions(partnerId, orderId);
      if (!postPrecheck.ok) return postPrecheck;
    }

    const imageUrls = await uploadWorkProofImages(imageFiles);
    const now = new Date();

    order.work_proof_image_urls = imageUrls;
    order.work_completion_description = description;
    order.work_completed_at = now;

    order.partner_work_status = PARTNER_WORK_STATUS_COMPLETED;
    touchPartnerWorkStatusInfo(order, PARTNER_WORK_STATUS_COMPLETED, partnerId, 'partner');

    touchOrderStatusInfo(order, ORDER_STATUS_COMPLETED);
    order.order_status = ORDER_STATUS_COMPLETED;
    order.updated_at = now;
    await order.save();

    await OrderService.updateMany(
      {
        _id: { $in: order.service_items },
        service_status: { $nin: [ORDER_STATUS_CANCELLED, ORDER_STATUS_REFUNDED] },
      },
      { $set: { service_status: ORDER_STATUS_COMPLETED, updated_at: now } }
    );

    let post = null;
    let postError = null;
    if (publishAsPost) {
      const postResult = await createOrderPostFromUrls(
        partnerId,
        order._id,
        imageUrls,
        description
      );
      if (!postResult.ok) {
        postError = postResult.message;
      } else {
        post = postResult.data.post;
        order.partner_post_id = postResult.data.postId;
        order.updated_at = new Date();
        await order.save();
      }
    }

    const record = await loadOrderDetailLean(order._id);
    const responseMessage = postError
      ? 'Order completed successfully, but feed post could not be created.'
      : 'Order completed successfully.';
    return ok(200, {
      message: responseMessage,
      record: stripAdminDescriptionForPublicApi(
        attachPartnerOrderSummary(embedOrderDetailForeignKeys(record))
      ),
      post,
      post_error: postError,
    });
  } catch (err) {
    console.error('mobile partner complete order work', err.message);
    return fail(500, 'Internal server error.');
  }
};

module.exports = {
  updatePartnerWorkStatus,
  completePartnerOrderWork,
};
