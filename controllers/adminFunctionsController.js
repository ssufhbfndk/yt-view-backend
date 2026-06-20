const db = require("../config/db");
const { queryAsync } = db;

const getUsersData = async (req, res, isSearch = false) => {
  try {
    let { page, limit, status, search } = req.query;

    if (!page || !limit) {
      return res.status(400).json({
        success: false,
        message: "page and limit required",
      });
    }

    if (isSearch && (!search || search.trim() === "")) {
      return res.status(400).json({
        success: false,
        message: "search required",
      });
    }

    page = parseInt(page);
    limit = parseInt(limit);

    const offset = (page - 1) * limit;

    let where = [];
    let params = [];

    // SEARCH CONDITION
    if (isSearch) {
      where.push(`
        (
          username LIKE ?
          OR number LIKE ?
          OR name LIKE ?
        )
      `);

      params.push(`%${search}%`);
      params.push(`%${search}%`);
      params.push(`%${search}%`);
    }

    // STATUS CONDITION
    if (
      status !== undefined &&
      status !== "all" &&
      status !== "lastactive"
    ) {
      const statusMap = {
        active: 1,
        blocked: 0,
        1: 1,
        0: 0,
      };

      const statusValue = statusMap[status];

      if (statusValue !== undefined) {
        where.push("status = ?");
        params.push(statusValue);
      }
    }

    const whereSQL =
      where.length > 0
        ? `WHERE ${where.join(" AND ")}`
        : "";

    let orderBy = "ORDER BY id DESC";

    if (status === "lastactive") {
      orderBy = "ORDER BY token_created_at DESC";
    }

    const sql = `
      SELECT
        id,
        name,
        username,
        email,
        number,
        status,
        num_views,
        token_created_at
      FROM user
      ${whereSQL}
      ${orderBy}
      LIMIT ? OFFSET ?
    `;

    const users = await queryAsync(sql, [
      ...params,
      limit,
      offset,
    ]);

    const countSQL = `
      SELECT COUNT(*) as total
      FROM user
      ${whereSQL}
    `;

    const countResult = await queryAsync(
      countSQL,
      params
    );

    return res.json({
      success: true,
      users,
      total: countResult?.[0]?.total || 0,
      totalPages: Math.ceil(
        (countResult?.[0]?.total || 0) / limit
      ),
      page,
    });

  } catch (err) {
    console.log(err);

    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

//get order fuction



const getOrdersData = async (req, res, isSearch = false) => {
  try {
    const {
      page,
      limit,
      search = "",
      status,
    } = req.query;

    // ==========================
    // VALIDATION
    // ==========================
    if (
      page === undefined ||
      limit === undefined ||
      status === undefined
    ) {
      return res.status(400).json({
        success: false,
        message: "page, limit, status required",
      });
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);

    if (
      isNaN(pageNum) ||
      isNaN(limitNum) ||
      pageNum < 1 ||
      limitNum < 1
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid page or limit",
      });
    }

    const offset = (pageNum - 1) * limitNum;

    // ==========================
    // SEARCH CONDITION
    // ==========================
    let searchCondition = "1=1";
    let searchParams = [];

    if (isSearch) {
      const searchValue = search.trim();

      if (searchValue !== "") {
        const isNumberSearch = /^\d+$/.test(searchValue);

        if (isNumberSearch) {
          searchCondition =
            "CAST(order_id AS CHAR) LIKE ?";
        } else {
          searchCondition =
            "video_link LIKE ?";
        }

        searchParams.push(`%${searchValue}%`);
      }
    }

    let query = "";
    let countQuery = "";

    // =========================================
    // ALL
    // =========================================
    if (status === "all") {

      query = `
SELECT * FROM (

  SELECT order_id,video_link,quantity,duration,remaining,
  'Valid' AS reason,'Unavailable' AS type,'pending' AS status
  FROM pending_orders

  UNION ALL

  SELECT order_id,video_link,quantity,duration,remaining,
  reason,'Unavailable' AS type,'errors' AS status
  FROM error_orders

  UNION ALL

  SELECT order_id,video_link,quantity,duration,remaining,
  error_reason AS reason,'Unavailable' AS type,'invalid' AS status
  FROM invalid_orders

  UNION ALL

  SELECT order_id,video_link,quantity,duration,remaining,
  'Valid' AS reason,type,'process' AS status
  FROM orders

  UNION ALL

  SELECT order_id,video_link,quantity,duration,remaining,
  'Valid' AS reason,type,'process' AS status
  FROM temp_orders

  UNION ALL

  SELECT order_id,video_link,quantity,duration,0 AS remaining,
  'Valid' AS reason,type,'complete' AS status
  FROM complete_orders

) AS all_orders

WHERE ${searchCondition}

ORDER BY order_id DESC

LIMIT ? OFFSET ?
`;

      countQuery = `
SELECT COUNT(*) AS total
FROM (

  SELECT order_id,video_link FROM pending_orders
  UNION ALL
  SELECT order_id,video_link FROM error_orders
  UNION ALL
  SELECT order_id,video_link FROM invalid_orders
  UNION ALL
  SELECT order_id,video_link FROM orders
  UNION ALL
  SELECT order_id,video_link FROM temp_orders
  UNION ALL
  SELECT order_id,video_link FROM complete_orders

) AS all_count

WHERE ${searchCondition}
`;
    }

    // pending
    else if (status === "pending") {

      query = `
SELECT
order_id,video_link,quantity,duration,remaining,
'Valid' AS reason,
'Unavailable' AS type,
'pending' AS status
FROM pending_orders

WHERE ${searchCondition}

ORDER BY order_id DESC

LIMIT ? OFFSET ?
`;

      countQuery = `
SELECT COUNT(*) AS total
FROM pending_orders
WHERE ${searchCondition}
`;
    }

    // invalid
    else if (status === "invalid") {

      query = `
SELECT
order_id,video_link,quantity,duration,remaining,
error_reason AS reason,
'Unavailable' AS type,
'invalid' AS status
FROM invalid_orders

WHERE ${searchCondition}

ORDER BY order_id DESC

LIMIT ? OFFSET ?
`;

      countQuery = `
SELECT COUNT(*) AS total
FROM invalid_orders
WHERE ${searchCondition}
`;
    }

    // errors
    else if (status === "errors") {

      query = `
SELECT
order_id,video_link,quantity,duration,remaining,
reason,
'Unavailable' AS type,
'errors' AS status
FROM error_orders

WHERE ${searchCondition}

ORDER BY order_id DESC

LIMIT ? OFFSET ?
`;

      countQuery = `
SELECT COUNT(*) AS total
FROM error_orders
WHERE ${searchCondition}
`;
    }

    // process
    else if (status === "process") {

      query = `
SELECT * FROM (

SELECT
order_id,video_link,quantity,duration,remaining,
'Valid' AS reason,
type,
'process' AS status
FROM orders

UNION ALL

SELECT
order_id,video_link,quantity,duration,remaining,
'Valid' AS reason,
type,
'process' AS status
FROM temp_orders

) AS process_orders

WHERE ${searchCondition}

ORDER BY order_id DESC

LIMIT ? OFFSET ?
`;

      countQuery = `
SELECT COUNT(*) AS total
FROM (
SELECT order_id,video_link FROM orders
UNION ALL
SELECT order_id,video_link FROM temp_orders
) AS process_count

WHERE ${searchCondition}
`;
    }

    // complete
    else if (status === "complete") {

      query = `
SELECT
order_id,video_link,quantity,duration,
0 AS remaining,
'Valid' AS reason,
type,
'complete' AS status
FROM complete_orders

WHERE ${searchCondition}

ORDER BY order_id DESC

LIMIT ? OFFSET ?
`;

      countQuery = `
SELECT COUNT(*) AS total
FROM complete_orders

WHERE ${searchCondition}
`;
    }

    else {
      return res.status(400).json({
        success: false,
        message: "Invalid status",
      });
    }

    // ==========================
    // EXECUTE
    // ==========================
    const orders = await db.queryAsync(
      query,
      [...searchParams, limitNum, offset]
    );

    const totalResult = await db.queryAsync(
      countQuery,
      searchParams
    );

    const total =
      totalResult?.[0]?.total || 0;

    return res.json({
      success: true,
      orders,
      total,
      totalPages:
        Math.ceil(total / limitNum) || 1,
      currentPage: pageNum,
    });

  } catch (err) {

    console.log(err);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch orders",
    });

  }
};

//GET TRANSACTIONS DATA

const getTransactionsData = async (req, res, isSearch = false) => {
  try {
    let { page, limit, status, search } = req.query;

    if (!page || !limit) {
      return res.status(400).json({
        success: false,
        message: "page and limit required",
      });
    }

    if (isSearch && (!search || search.trim() === "")) {
      return res.status(400).json({
        success: false,
        message: "search required",
      });
    }

    page = parseInt(page);
    limit = parseInt(limit);

    const offset = (page - 1) * limit;

    let where = [];
    let params = [];

    // =========================
    // SEARCH CONDITION
    // =========================
    if (isSearch) {
      where.push(`
        (
          username LIKE ?
          OR CAST(id AS CHAR) LIKE ?
          OR invoice_num LIKE ?
        )
      `);

      params.push(`%${search}%`);
      params.push(`%${search}%`);
      params.push(`%${search}%`);
    }

    // =========================
    // STATUS CONDITION
    // =========================
    if (status !== undefined && status !== "all") {
      const statusMap = {
        pending: 0,
        completed: 1,
        rejected: 2,
        0: 0,
        1: 1,
        2: 2,
      };

      const statusValue = statusMap[status];

      if (statusValue !== undefined) {
        where.push("status = ?");
        params.push(statusValue);
      }
    }

    const whereSQL =
      where.length > 0
        ? `WHERE ${where.join(" AND ")}`
        : "";

    const sql = `
      SELECT
        id,
        username,
        bank_name,
        bank_account_number,
        account_holder_name,
        coins,
        amount_pkr,
        amount_usd,
        status,
        invoice_num,
        created_at,
        status_updated_at
      FROM payment_history
      ${whereSQL}
      ORDER BY id DESC
      LIMIT ? OFFSET ?
    `;

    const transactions = await queryAsync(sql, [
      ...params,
      limit,
      offset,
    ]);

    const countSQL = `
      SELECT COUNT(*) as total
      FROM payment_history
      ${whereSQL}
    `;

    const countResult = await queryAsync(
      countSQL,
      params
    );

    return res.json({
      success: true,
      transactions,
      total: countResult?.[0]?.total || 0,
      totalPages: Math.ceil(
        (countResult?.[0]?.total || 0) / limit
      ),
      page,
    });

  } catch (err) {
    console.log(err);

    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

module.exports = {
   getUsersData,
   getOrdersData,
   getTransactionsData
};