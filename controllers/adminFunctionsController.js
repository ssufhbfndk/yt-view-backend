const { queryAsync } = require("../config/db");


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


module.exports = {
   getUsersData
};