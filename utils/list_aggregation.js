/**
 * Shared MongoDB aggregation stages for order/quote (and similar) getAll list endpoints.
 */

const { attachPartnerRatingFields } = require("./rating_format");

const lookupById = (from, localField, as) => ({
  $lookup: { from, localField, foreignField: "_id", as },
});

const unwind = (path) => ({
  $unwind: { path, preserveNullAndEmptyArrays: true },
});

const buildHydratedUserField = (sourceKey, outputKey) => ({
  [outputKey]: {
    $cond: [
      { $ifNull: [`$${sourceKey}._id`, false] },
      {
        _id: `$${sourceKey}._id`,
        name: `$${sourceKey}.name`,
        user_id: `$${sourceKey}.user_id`,
        email: `$${sourceKey}.email`,
        phone_number: `$${sourceKey}.phone_number`,
        profile_url: `$${sourceKey}.profile_url`,
        type: `$${sourceKey}.type`,
        average_rating: `$${sourceKey}.average_rating`,
        rating_count: `$${sourceKey}.rating_count`,
      },
      null,
    ],
  },
});

const buildHydratedCategoryField = () => ({
  category_id: {
    $cond: [
      { $ifNull: ["$_category._id", false] },
      {
        _id: "$_category._id",
        name: "$_category.name",
        category_id: "$_category.category_id",
        desc: "$_category.desc",
        image_url: "$_category.image_url",
        approval_status: "$_category.approval_status",
        is_request: "$_category.is_request",
        is_active: "$_category.is_active",
        rejection_reason: "$_category.rejection_reason",
      },
      null,
    ],
  },
});

const buildHydratedServiceField = () => ({
  service_id: {
    $cond: [
      { $ifNull: ["$_service._id", false] },
      {
        _id: "$_service._id",
        name: "$_service.name",
        service_id: "$_service.service_id",
        desc: "$_service.desc",
        image_url: "$_service.image_url",
        approval_status: "$_service.approval_status",
        is_request: "$_service.is_request",
        is_active: "$_service.is_active",
        rejection_reason: "$_service.rejection_reason",
        payment_type: "$_service.payment_type",
      },
      null,
    ],
  },
});

const buildHydratedFranchiseField = () => ({
  franchise_id: {
    $cond: [
      { $ifNull: ["$_franchise._id", false] },
      {
        _id: "$_franchise._id",
        name: "$_franchise.name",
        city_name: "$_franchise.city_name",
        state_name: "$_franchise.state_name",
      },
      null,
    ],
  },
});

const buildHydratedOrderField = () => ({
  order_id: {
    $cond: [
      { $ifNull: ["$_order._id", false] },
      {
        _id: "$_order._id",
        unique_id: "$_order.unique_id",
        order_status: "$_order.order_status",
        total_price: "$_order.total_price",
        user_id: "$_order.user_id",
      },
      null,
    ],
  },
});

const buildHydratedAddressField = ({ includeArea = false } = {}) => {
  const geoMerge = {
    city_id: {
      $cond: [
        { $ifNull: ["$_addr_city._id", false] },
        { _id: "$_addr_city._id", name: "$_addr_city.name" },
        "$_address.city_id",
      ],
    },
    state_id: {
      $cond: [
        { $ifNull: ["$_addr_state._id", false] },
        { _id: "$_addr_state._id", name: "$_addr_state.name" },
        "$_address.state_id",
      ],
    },
  };

  if (includeArea) {
    geoMerge.area_id = {
      $cond: [
        { $ifNull: ["$_addr_area._id", false] },
        { _id: "$_addr_area._id", name: "$_addr_area.name" },
        "$_address.area_id",
      ],
    };
  }

  return {
    address_id: {
      $cond: [
        { $ifNull: ["$_address._id", false] },
        {
          $mergeObjects: ["$_address", geoMerge],
        },
        null,
      ],
    },
  };
};

const buildParticipantLookupsAndUnwinds = (usersColl) => {
  const paths = ["_user", "_partner", "_employee", "_created_by"];
  const stages = [
    lookupById(usersColl, "user_id", "_user"),
    lookupById(usersColl, "partner_id", "_partner"),
    lookupById(usersColl, "employee_id", "_employee"),
    lookupById(usersColl, "created_by_id", "_created_by"),
  ];
  for (const p of paths) {
    stages.push(unwind(`$${p}`));
  }
  return stages;
};

const buildCatalogLookupsAndUnwinds = (
  categoriesColl,
  servicesColl,
  franchiseColl
) => [
  lookupById(categoriesColl, "category_id", "_category"),
  lookupById(servicesColl, "service_id", "_service"),
  lookupById(franchiseColl, "franchise_id", "_franchise"),
  unwind("$_category"),
  unwind("$_service"),
  unwind("$_franchise"),
];

const buildAddressLookupsAndUnwinds = (addressColl) => [
  lookupById(addressColl, "address_id", "_address"),
  unwind("$_address"),
];

const buildAddressGeoLookupsAndUnwinds = (
  citiesColl,
  statesColl,
  { includeArea = false, areasColl = null } = {}
) => {
  const stages = [
    lookupById(citiesColl, "_address.city_id", "_addr_city"),
    lookupById(statesColl, "_address.state_id", "_addr_state"),
  ];
  if (includeArea && areasColl) {
    stages.push(lookupById(areasColl, "_address.area_id", "_addr_area"));
  }
  stages.push(unwind("$_addr_city"), unwind("$_addr_state"));
  if (includeArea && areasColl) {
    stages.push(unwind("$_addr_area"));
  }
  return stages;
};

const buildSearchMatchStage = (regex, searchFields) => {
  if (!regex || !searchFields?.length) return [];
  return [{ $match: { $or: searchFields.map((field) => ({ [field]: regex })) } }];
};

const buildListFacetStages = (skip, limit) => [
  {
    $facet: {
      data: [{ $skip: skip }, { $limit: limit }],
      totalCount: [{ $count: "totalCount" }],
    },
  },
];

/** Populate order.service_items (ObjectId[]) with order_service documents for list APIs. */
const buildServiceItemsLookupStage = (orderServicesColl) => ({
  $lookup: {
    from: orderServicesColl,
    let: { lineIds: "$service_items" },
    pipeline: [
      {
        $match: {
          $expr: { $in: ["$_id", "$$lineIds"] },
          deleted_at: null,
        },
      },
      {
        $project: {
          _id: 1,
          order_id: 1,
          order_unique_id: 1,
          service_status: 1,
          service_date: 1,
          service_from_time: 1,
          service_to_time: 1,
          is_paid: 1,
          service_price: 1,
          total_service_charge: 1,
          total_price: 1,
          partner_earning: 1,
          admin_earning: 1,
        },
      },
    ],
    as: "service_items",
  },
});

const DEFAULT_STRIP_INTERNAL = [
  "_user",
  "_partner",
  "_employee",
  "_created_by",
  "_category",
  "_service",
  "_franchise",
  "_address",
  "_addr_city",
  "_addr_state",
];

/**
 * @param {object} config
 * @param {object} config.baseFilter - initial $match filter
 * @param {object} config.sortStage - e.g. { created_at: -1 }
 * @param {number} config.skip
 * @param {number} config.limit
 * @param {RegExp|null} [config.regex]
 * @param {string[]} [config.searchFields]
 * @param {object} config.collections - { users, categories, services, franchise, address, cities, states, areas?, quotes?, orders?, orderServices? }
 * @param {boolean} [config.includeRootCityLookup]
 * @param {boolean} [config.includeQuoteLookup]
 * @param {boolean} [config.includeOrderLookup]
 * @param {boolean} [config.includeServiceItemsLookup]
 * @param {boolean} [config.includeAreaOnAddress]
 * @param {object} [config.extraAddFields] - merged into hydration $addFields
 * @param {object} [config.extraProject] - merged into final $project (e.g. { history: 0 })
 * @param {string[]} [config.stripInternalFields]
 */
const buildEntityListPipeline = (config) => {
  const {
    baseFilter,
    sortStage,
    skip,
    limit,
    regex = null,
    searchFields = [],
    collections,
    includeRootCityLookup = false,
    includeQuoteLookup = false,
    includeOrderLookup = false,
    includeServiceItemsLookup = false,
    includeAreaOnAddress = false,
    extraAddFields = {},
    extraProject = {},
    stripInternalFields,
  } = config;

  const {
    users,
    categories,
    services,
    franchise,
    address,
    cities,
    states,
    areas = null,
    quotes = null,
    orders = null,
    orderServices = null,
  } = collections;

  const stripFields = [...(stripInternalFields || DEFAULT_STRIP_INTERNAL)];
  if (includeRootCityLookup) stripFields.push("_city");
  if (includeQuoteLookup) stripFields.push("_quote");
  if (includeOrderLookup) stripFields.push("_order");
  if (includeAreaOnAddress) stripFields.push("_addr_area");

  const displayAddFields = {
    user_name: "$_user.name",
    user_unique_id: "$_user.user_id",
    partner_name: "$_partner.name",
    partner_unique_id: "$_partner.user_id",
    employee_name: "$_employee.name",
    category_name: "$_category.name",
    service_name: "$_service.name",
    ...(includeRootCityLookup && {
      city_name: { $ifNull: ["$_city.name", ""] },
    }),
    ...buildHydratedUserField("_user", "user_id"),
    ...buildHydratedUserField("_partner", "partner_id"),
    ...buildHydratedUserField("_employee", "employee_id"),
    ...buildHydratedUserField("_created_by", "created_by_id"),
    ...buildHydratedCategoryField(),
    ...buildHydratedServiceField(),
    ...buildHydratedFranchiseField(),
    ...buildHydratedAddressField({ includeArea: includeAreaOnAddress }),
    ...(includeOrderLookup ? buildHydratedOrderField() : {}),
    ...extraAddFields,
  };

  const projectStrip = stripFields.reduce((acc, key) => {
    acc[key] = 0;
    return acc;
  }, {});

  const pipeline = [
    { $match: baseFilter },
    ...buildParticipantLookupsAndUnwinds(users),
    ...buildCatalogLookupsAndUnwinds(categories, services, franchise),
    ...(includeRootCityLookup
      ? [lookupById(cities, "city_id", "_city"), unwind("$_city")]
      : []),
    ...buildAddressLookupsAndUnwinds(address),
    ...buildAddressGeoLookupsAndUnwinds(cities, states, {
      includeArea: includeAreaOnAddress,
      areasColl: areas,
    }),
    ...(includeQuoteLookup && quotes
      ? [
          lookupById(quotes, "quote_id", "_quote"),
          unwind("$_quote"),
        ]
      : []),
    ...(includeOrderLookup && orders
      ? [lookupById(orders, "order_id", "_order"), unwind("$_order")]
      : []),
    ...(includeServiceItemsLookup && orderServices
      ? [buildServiceItemsLookupStage(orderServices)]
      : []),
    ...buildSearchMatchStage(regex, searchFields),
    { $sort: sortStage },
    { $addFields: displayAddFields },
    { $project: { ...projectStrip, ...extraProject } },
    ...buildListFacetStages(skip, limit),
  ];

  return pipeline;
};

/** Same pipeline as list APIs but without pagination facet (for Excel export). */
const buildEntityExportPipeline = (config) => {
  const pipeline = buildEntityListPipeline({ ...config, skip: 0, limit: 1 });
  pipeline.pop();
  return pipeline;
};

const parseFacetListResult = (result, limit) => {
  const facet = result[0] || { data: [], totalCount: [] };
  const data = facet.data || [];
  const totalCount =
    facet.totalCount && facet.totalCount[0] ? facet.totalCount[0].totalCount : 0;
  const totalPages = Math.ceil(totalCount / limit) || 0;
  return { data, totalCount, totalPages };
};

/** Collection names from Mongoose models (pass model constructors). */
const getListCollectionNames = (models) => {
  const names = {};
  for (const [key, Model] of Object.entries(models)) {
    if (Model?.collection?.name) {
      names[key] = Model.collection.name;
    }
  }
  return names;
};

const hydrateUserRef = (user) => {
  if (!user || typeof user !== "object" || user._id == null) return null;
  const base = {
    _id: user._id,
    name: user.name,
    user_id: user.user_id,
    email: user.email,
    phone_number: user.phone_number,
    profile_url: user.profile_url,
    type: user.type,
  };
  if (user.average_rating !== undefined || user.rating_count !== undefined) {
    return { ...base, ...attachPartnerRatingFields(user) };
  }
  return base;
};

const hydrateCategoryRef = (category) => {
  if (!category || typeof category !== "object" || category._id == null) return null;
  return {
    _id: category._id,
    name: category.name,
    category_id: category.category_id,
    desc: category.desc,
    image_url: category.image_url,
    approval_status: category.approval_status,
    is_request: category.is_request,
    is_active: category.is_active,
    rejection_reason: category.rejection_reason,
  };
};

const hydrateServiceRef = (service) => {
  if (!service || typeof service !== "object" || service._id == null) return null;
  return {
    _id: service._id,
    name: service.name,
    service_id: service.service_id,
    desc: service.desc,
    image_url: service.image_url,
    approval_status: service.approval_status,
    is_request: service.is_request,
    is_active: service.is_active,
    rejection_reason: service.rejection_reason,
    payment_type: service.payment_type ?? "",
  };
};

const hydrateFranchiseRef = (franchise) => {
  if (!franchise || typeof franchise !== "object" || franchise._id == null) return null;
  return {
    _id: franchise._id,
    name: franchise.name,
    city_name: franchise.city_name,
    state_name: franchise.state_name,
  };
};

const hydrateCityRef = (city) => {
  if (!city || typeof city !== "object" || city._id == null) return null;
  return {
    _id: city._id,
    name: city.name,
  };
};

const hydrateQuoteRef = (quote) => {
  if (!quote || typeof quote !== "object" || quote._id == null) return null;
  return {
    _id: quote._id,
    quote_sequence_id: quote.quote_sequence_id,
    quote_description: quote.quote_description,
    status: quote.status,
    service_price: quote.service_price,
    from_date: quote.from_date,
    to_date: quote.to_date,
    created_at: quote.created_at,
  };
};

const hydrateAddressRef = (address) => {
  if (!address || typeof address !== "object" || address._id == null) return null;
  const out = { ...address };
  if (out.city_id && typeof out.city_id === "object" && out.city_id._id != null) {
    out.city_id = { _id: out.city_id._id, name: out.city_id.name };
  }
  if (out.state_id && typeof out.state_id === "object" && out.state_id._id != null) {
    out.state_id = { _id: out.state_id._id, name: out.state_id.name };
  }
  if (out.area_id && typeof out.area_id === "object" && out.area_id._id != null) {
    out.area_id = { _id: out.area_id._id, name: out.area_id.name };
  }
  return out;
};

/** Map admin/detail *_info fields to embedded FK objects (order getAll list parity). */
const embedOrderDetailForeignKeys = (record) => {
  if (!record || typeof record !== "object") return record;

  const user = hydrateUserRef(record.user_info);
  const partner = hydrateUserRef(record.partner_info);
  const employee = hydrateUserRef(record.employee_info);
  const createdBy = hydrateUserRef(record.created_by_info);
  const category = hydrateCategoryRef(record.category_info);
  const service = hydrateServiceRef(record.service_info);
  const franchise = hydrateFranchiseRef(record.franchise_info);
  const city = hydrateCityRef(record.city_info);
  const quote = hydrateQuoteRef(record.quote_info);
  const address = hydrateAddressRef(record.address_info);

  const {
    user_info: _u,
    partner_info: _p,
    employee_info: _e,
    created_by_info: _c,
    category_info: _cat,
    service_info: _svc,
    franchise_info: _f,
    address_info: _a,
    city_info: _city,
    quote_info: _q,
    created_by_name: _cbn,
    ...rest
  } = record;

  return {
    ...rest,
    user_id: user,
    partner_id: partner,
    employee_id: employee,
    created_by_id: createdBy,
    category_id: category,
    service_id: service,
    franchise_id: franchise,
    city_id: city,
    quote_id: quote,
    address_id: address,
    user_name: user?.name ?? null,
    user_unique_id: user?.user_id ?? record.user_unique_id ?? null,
    partner_name: partner?.name ?? null,
    partner_unique_id: partner?.user_id ?? null,
    employee_name: employee?.name ?? null,
    category_name: category?.name ?? null,
    service_name: service?.name ?? null,
    city_name: city?.name ?? null,
  };
};

module.exports = {
  buildEntityListPipeline,
  buildEntityExportPipeline,
  buildServiceItemsLookupStage,
  parseFacetListResult,
  getListCollectionNames,
  buildSearchMatchStage,
  buildListFacetStages,
  hydrateUserRef,
  hydrateCategoryRef,
  hydrateServiceRef,
  hydrateFranchiseRef,
  hydrateCityRef,
  hydrateQuoteRef,
  hydrateAddressRef,
  embedOrderDetailForeignKeys,
};
