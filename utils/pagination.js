const applyPagination = async (
  model,
  filter = {},
  page = 1,
  limit = 10,
  sort = {},
  projection = {},
  populateFields = [], // Array of fields to populate
  options = {} // { collation } — optional, e.g. case-insensitive string sort
) => {
  const skip = (page - 1) * limit;

  // Remove null values from populateFields to avoid errors
  const validPopulateFields = populateFields.filter(field => field !== null);

  const dedupeField = options.dedupeByField;
  const dedupeStages =
    dedupeField && typeof dedupeField === 'string'
      ? [
          {
            $addFields: {
              __dedupeKey: {
                $toLower: {
                  $trim: {
                    input: { $ifNull: [`$${dedupeField}`, ''] },
                  },
                },
              },
            },
          },
          { $sort: sort },
          {
            $group: {
              _id: '$__dedupeKey',
              __doc: { $first: '$$ROOT' },
            },
          },
          { $replaceRoot: { newRoot: '$__doc' } },
          { $project: { __dedupeKey: 0 } },
          { $sort: sort },
        ]
      : [{ $sort: sort }];

  // Define the aggregation pipeline
  const pipeline = [
    { $match: filter }, // Match documents based on the filter
    ...dedupeStages,
    {
      $facet: {
        data: [
          { $skip: skip }, // Pagination
          { $limit: limit }, // Limit results
          ...(Object.keys(projection).length > 0 ? [{ $project: projection }] : []), // Add projection if provided
        ],
        totalCount: [{ $count: "totalCount" }], // Count total matching documents using $count
      },
    },
  ];

  let agg = model.aggregate(pipeline);
  if (options.collation) {
    agg = agg.collation(options.collation);
  }
  const result = await agg;

  // Extract paginated data and total count
  const data = result[0].data;
  const totalCount = result[0].totalCount.length > 0 ? result[0].totalCount[0].totalCount : 0;

  // Populate fields after fetching the data
  const populatedData = validPopulateFields.length > 0
    ? await model.populate(data, validPopulateFields)
    : data; // Only apply populate if valid fields exist

  // Calculate total pages
  const totalPages = Math.ceil(totalCount / limit);

  return { data: populatedData, totalCount, totalPages, currentPage: page };
};

const applyDropDownFilter = async (
  model,
  filter = {},
  
  sort = {},
  projection = {},
  populateFields = []
) => {
  const validPopulateFields = populateFields.filter(field => field !== null);
  const pipeline = [
    { $match: filter },
    { $sort: sort },
    {
      $facet: {
        data: [
          ...(Object.keys(projection).length > 0 ? [{ $project: projection }] : []),
        ],
      },
    },
  ];
  const result = await model.aggregate(pipeline);
  const data = result[0].data;
  const populatedData = validPopulateFields.length > 0
    ? await model.populate(data, validPopulateFields)
    : data;
  return { data: populatedData,};
};


module.exports = { applyPagination,applyDropDownFilter};