#!/usr/bin/env python3
"""
Upload products from woocommerce_products.json to a WooCommerce store.

Credentials are loaded from mc-template/config.py (which fetches them from the
database server at DATABASE_SERVER_URL). The target site must be specified as
a command-line argument or via the SITE_ID environment variable.

Usage:
  upload.py <site_id> [options]

Positional argument:
  site_id           - The site slug/ID as registered in the database server
                      (e.g. "fraternitees" or whatever the 'id' field is in /mls)

Optional environment variables:
  DATABASE_SERVER_URL  - Override the config.py default (http://192.168.0.2:8888)
  ORDERBOARD_BASE_URL  - Base URL for fetching mockup images
                         (default: https://orderboard.mlswebstores.com)
  PRODUCTS_FILE        - Path to JSON file (default: woocommerce_products.json)
"""

import argparse
import base64
import datetime
import getpass
import json
import logging
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from io import BytesIO

import requests
from PIL import Image
from woocommerce import API

# ---------------------------------------------------------------------------
# Import config.py from the same directory as this script
# ---------------------------------------------------------------------------
_script_dir = os.path.dirname(os.path.abspath(__file__))
if _script_dir not in sys.path:
    sys.path.insert(0, _script_dir)

import importlib.util as _ilu
_spec = _ilu.spec_from_file_location("mc_config", os.path.join(_script_dir, "config.py"))
mc_config = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(mc_config)  # type: ignore[union-attr]

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logger = logging.getLogger("uploader")
logger.setLevel(logging.INFO)
_fmt = logging.Formatter(
    "[%(asctime)s - %(funcName)20s() ] - %(levelname)s - %(message)s",
    "%Y-%m-%d %H:%M:%S",
)
_ch = logging.StreamHandler()
_ch.setFormatter(_fmt)
logger.addHandler(_ch)
_fh = logging.FileHandler("upload.log", "w")
_fh.setFormatter(_fmt)
logger.addHandler(_fh)

# ---------------------------------------------------------------------------
# Image helpers
# ---------------------------------------------------------------------------
def _to_webp(raw_bytes: bytes, square_pad: bool = False) -> bytes:
    """Convert raw image bytes (any format) to WebP at IMAGE_WEBP_QUALITY.

    If square_pad is True the image is centered on a square canvas whose side
    equals the longest dimension, with transparent padding on the shorter sides.
    """
    img = Image.open(BytesIO(raw_bytes))
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGBA")

    if square_pad:
        w, h = img.size
        side = max(w, h)
        canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        canvas.paste(img, ((side - w) // 2, (side - h) // 2))
        img = canvas

    out = BytesIO()
    img.save(out, format="webp", quality=IMAGE_WEBP_QUALITY, method=6)
    return out.getvalue()


# ---------------------------------------------------------------------------
# Image upload cache — prevents duplicate uploads across parallel workers
# ---------------------------------------------------------------------------
_image_cache: dict = {}          # filename -> media dict (populated on first upload)
_image_locks: dict = {}          # filename -> per-file Lock
_image_locks_guard = threading.Lock()  # protects _image_locks dict itself
_orderboard_sem = threading.Semaphore(3)  # caps concurrent orderboard image downloads


def _image_lock_for(filename: str) -> threading.Lock:
    """Return (creating if needed) the per-filename lock."""
    with _image_locks_guard:
        if filename not in _image_locks:
            _image_locks[filename] = threading.Lock()
        return _image_locks[filename]


# ---------------------------------------------------------------------------
# Retry helper
# ---------------------------------------------------------------------------
_RETRY_STATUS_CODES = {502, 503, 504}
_MAX_RETRIES = 5
_RETRY_BACKOFF = 2.0  # seconds; doubles each attempt


def _retry(fn, *args, label="request", **kwargs):
    """Call fn(*args, **kwargs) and retry on 5xx gateway errors."""
    delay = _RETRY_BACKOFF
    for attempt in range(1, _MAX_RETRIES + 1):
        try:
            resp = fn(*args, **kwargs)
        except requests.exceptions.ConnectionError as e:
            if attempt == _MAX_RETRIES:
                raise
            logger.warning("%s: connection error (attempt %d/%d), retrying in %.0fs: %s",
                           label, attempt, _MAX_RETRIES, delay, e)
            time.sleep(delay)
            delay *= 2
            continue
        if hasattr(resp, "status_code") and resp.status_code in _RETRY_STATUS_CODES:
            if attempt == _MAX_RETRIES:
                return resp
            logger.warning("%s: got %d (attempt %d/%d), retrying in %.0fs",
                           label, resp.status_code, attempt, _MAX_RETRIES, delay)
            time.sleep(delay)
            delay *= 2
            continue
        return resp
    return resp  # unreachable but satisfies linters


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
SITE_ID = None  # set at runtime via CLI argument (or SITE_ID env var fallback)
ORDERBOARD_BASE_URL = os.environ.get("ORDERBOARD_BASE_URL", "https://orderboard.mlswebstores.com")
#ORDERBOARD_BASE_URL = os.environ.get("ORDERBOARD_BASE_URL", "http://localhost:3000")
PRODUCTS_FILE = os.environ.get("PRODUCTS_FILE", "products.json")

# Orderboard API fetch (optional — used when --api flag is passed)
ORDERBOARD_API_URL = os.environ.get("ORDERBOARD_API_URL", "https://orderboard.mlswebstores.com")          # e.g. https://myapp.railway.app
ORDERBOARD_EMAIL = os.environ.get("ORDERBOARD_EMAIL", "")
ORDERBOARD_PASSWORD = os.environ.get("ORDERBOARD_PASSWORD", "")
ORDERBOARD_STORE_ID = os.environ.get("ORDERBOARD_STORE_ID", "")

# Size display order for post-upload reordering
SIZES_ORDER = [
    "XXS", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "6XL",
    "XLT", "2XLT", "3XLT", "4XLT", "5XLT", "6XLT",
    "20OZ",
]

# Image processing before upload
IMAGE_MAX_WIDTH = 700    # width (px) requested from server; 0 = no resize
IMAGE_WEBP_QUALITY = 85  # WebP quality 1–100; 85 is visually lossless for mockups


def load_site_config():
    """Load site credentials from the database server via mc_config."""
    if not SITE_ID:
        logger.error("SITE_ID environment variable is not set.")
        logger.error("Set it to the site slug from the database server (e.g. export SITE_ID=fraternitees)")
        sys.exit(1)

    try:
        cfg = mc_config.config()
    except Exception as e:
        logger.error("Failed to load config from config.py: %s", e)
        logger.error("Is the database server running at %s?",
                     os.environ.get("DATABASE_SERVER_URL", "http://192.168.0.2:8888"))
        sys.exit(1)

    site = cfg.getStoreKeyById(SITE_ID)
    if not site:
        logger.error("Site '%s' not found in the database server.", SITE_ID)
        logger.error("Available sites:\n%s", "\n".join(sorted(s["id"] for s in cfg.sites)))
        sys.exit(1)

    return cfg, site


# ---------------------------------------------------------------------------
# WooCommerce API client
# ---------------------------------------------------------------------------
def get_wcapi(site):
    return API(
        url=site["url"],
        consumer_key=site["key"],
        consumer_secret=site["secret"],
        wp_api=True,
        query_string_auth=True,
        timeout=500,
        version="wc/v3",
    )


def wp_auth_headers(site, content_type="application/json"):
    """Return WordPress Basic Auth headers using app_user / app_pass."""
    token = base64.b64encode(f"{site['app_user']}:{site['app_pass']}".encode()).decode()
    return {"Authorization": f"Basic {token}", "Content-Type": content_type}


# ---------------------------------------------------------------------------
# Generic WooCommerce fetch helper
# ---------------------------------------------------------------------------
def fetch_paginated(wcapi, path):
    """Fetch all pages from a WooCommerce REST endpoint."""
    data = []
    page = 1
    per_page = 50

    # Split any inline query params out of the path so we can merge cleanly
    if "?" in path:
        base_path, qs = path.split("?", 1)
        extra_params = dict(p.split("=", 1) for p in qs.split("&") if "=" in p)
    else:
        base_path = path
        extra_params = {}

    while True:
        params = {"page": page, "per_page": per_page, **extra_params}
        r = _retry(wcapi.get, base_path, params=params, label=f"GET {base_path}")
        if r.status_code != 200:
            logger.error("Failed to fetch %s: %s", path, r.text)
            break
        items = r.json()
        data += items
        if int(r.headers.get("x-wp-total", 0)) == 0 or page >= int(r.headers.get("x-wp-totalpages", 1)):
            break
        page += 1
    return data


# ---------------------------------------------------------------------------
# Attribute / term helpers
# ---------------------------------------------------------------------------
def ensure_global_attribute(wcapi, woo_attrs, name, slug=None):
    """Get or create a WooCommerce global product attribute. Returns the attribute dict."""
    found = next((a for a in woo_attrs if a["name"].lower() == name.lower()), None)
    if found:
        return found
    payload = {"name": name, "type": "select", "order_by": "menu_order", "has_archives": False}
    if slug:
        payload["slug"] = slug
    resp = _retry(wcapi.post, "products/attributes", payload, label=f"create attribute {name}")
    if resp.status_code == 201:
        attr = resp.json()
        woo_attrs.append(attr)
        logger.info("Created attribute '%s' (ID: %d)", name, attr["id"])
        return attr
    logger.error("Failed to create attribute '%s': %s", name, resp.text)
    return None


def ensure_attribute_terms(wcapi, attr_id, terms):
    """
    Ensure all terms exist for a global attribute.

    terms: list of {"name": str, "slug": str} dicts.
    Returns a dict mapping slug -> term dict (with id).
    """
    existing = fetch_paginated(wcapi, f"products/attributes/{attr_id}/terms")
    existing_by_slug = {t["slug"]: t for t in existing}

    to_create = [t for t in terms if t["slug"] not in existing_by_slug]
    if to_create:
        resp = _retry(wcapi.post,
            f"products/attributes/{attr_id}/terms/batch",
            {"create": to_create},
            label=f"batch create terms attr {attr_id}",
        )
        if resp.status_code == 200:
            for created in resp.json().get("create", []):
                if "slug" not in created:
                    error = created.get("error", {})
                    resource_id = (error.get("data") or {}).get("resource_id")
                    if error.get("code") == "term_exists" and resource_id:
                        # Term already exists — fetch it and add to the map
                        term_resp = _retry(wcapi.get, f"products/attributes/{attr_id}/terms/{resource_id}", label="fetch existing term")
                        if term_resp.status_code == 200:
                            term = term_resp.json()
                            existing_by_slug[term["slug"]] = term
                            logger.info("Reusing existing term '%s' (slug: %s, id: %d)", term["name"], term["slug"], term["id"])
                        else:
                            logger.warning("Could not fetch existing term %d: %s", resource_id, term_resp.text)
                    else:
                        logger.warning("Skipping term with no slug in batch response: %s", created)
                    continue
                existing_by_slug[created["slug"]] = created
                logger.info("Created attribute term '%s' (slug: %s)", created["name"], created["slug"])
        else:
            logger.error("Failed to batch-create attribute terms for attr %d: %s", attr_id, resp.text)

    return existing_by_slug


# ---------------------------------------------------------------------------
# Category / tag helpers
# ---------------------------------------------------------------------------
def ensure_categories(wcapi, categories):
    """Ensure category hierarchy exists. Returns list of {"id": int} dicts."""
    all_categories = fetch_paginated(wcapi, "products/categories")
    category_ids = []

    for cat_path in categories:
        path_parts = [p.strip() for p in cat_path.split(">")]
        parent_id = 0
        final_id = None

        for cat_name in path_parts:
            if not cat_name:
                continue
            found = next(
                (c for c in all_categories
                 if c["name"].lower() == cat_name.lower() and c["parent"] == parent_id),
                None,
            )
            if found:
                final_id = found["id"]
                parent_id = final_id
            else:
                resp = _retry(wcapi.post, "products/categories", {"name": cat_name, "parent": parent_id}, label=f"create category {cat_name}")
                if resp.status_code == 201:
                    new_cat = resp.json()
                    all_categories.append(new_cat)
                    final_id = new_cat["id"]
                    parent_id = final_id
                    logger.info("Created category '%s' (ID: %d)", cat_name, final_id)
                else:
                    logger.error("Failed to create category '%s': %s", cat_name, resp.text)
                    final_id = None
                    break

        if final_id and {"id": final_id} not in category_ids:
            category_ids.append({"id": final_id})

    return category_ids


def ensure_tags(wcapi, tags):
    """Ensure tags exist. Returns list of {"id": int} dicts."""
    existing = fetch_paginated(wcapi, "products/tags")
    tag_map = {t["name"].lower(): t["id"] for t in existing}
    tag_ids = []

    for tag_name in tags:
        if tag_name.lower() in tag_map:
            tag_ids.append({"id": tag_map[tag_name.lower()]})
        else:
            resp = _retry(wcapi.post, "products/tags", {"name": tag_name}, label=f"create tag {tag_name}")
            if resp.status_code == 201:
                new_tag = resp.json()
                tag_map[tag_name.lower()] = new_tag["id"]
                tag_ids.append({"id": new_tag["id"]})
                logger.info("Created tag '%s' (ID: %d)", tag_name, new_tag["id"])
            else:
                data = resp.json() if resp.text else {}
                resource_id = (data.get("data") or {}).get("resource_id")
                if data.get("code") == "term_exists" and resource_id:
                    tag_map[tag_name.lower()] = resource_id
                    tag_ids.append({"id": resource_id})
                    logger.info("Reusing existing tag '%s' (ID: %d)", tag_name, resource_id)
                else:
                    logger.error("Failed to create tag '%s': %s", tag_name, resp.text)

    return tag_ids


# ---------------------------------------------------------------------------
# Image helpers
# ---------------------------------------------------------------------------
def is_file_in_media_lib(site, filename):
    """Search WordPress media library. Returns item dict or {} if not found."""
    url = f"{site['url']}/wp-json/wp/v2/media?search={filename}"
    res = _retry(requests.get, url, headers=wp_auth_headers(site), timeout=30, label=f"media search {filename}")
    if res.status_code == 200:
        for item in res.json():
            try:
                if os.path.basename(item["media_details"]["file"]).lower() == filename.lower():
                    return item
            except Exception:
                pass
    return {}


def upload_image_from_url(site, mockup_url, square_pad=False):
    """
    Download a mockup image from the catalog server and upload it to WordPress.

    mockup_url may be a full URL or a relative path like /api/generate-mockup/...
    Returns the media item dict (with 'id') or None on failure.

    A per-filename lock ensures that concurrent workers never upload the same
    image more than once; subsequent callers receive the cached media dict.
    """
    if mockup_url.startswith("http"):
        full_url = mockup_url
    else:
        full_url = ORDERBOARD_BASE_URL.rstrip("/") + mockup_url

    # Build a stable filename — always .webp since we convert on upload
    path_part = mockup_url.split("?")[0]
    parts = [p for p in path_part.strip("/").split("/") if p]
    filename = "_".join(parts[-2:]) + ".webp" if len(parts) >= 2 else "mockup.webp"

    # Ask the server for a pre-resized image to minimise download size
    if IMAGE_MAX_WIDTH > 0:
        sep = "&" if "?" in full_url else "?"
        full_url = f"{full_url}{sep}width={IMAGE_MAX_WIDTH}"

    # Fast path: already resolved by another worker this session
    if filename in _image_cache:
        logger.info("Image '%s' reusing cached ID %d", filename, _image_cache[filename]["id"])
        return _image_cache[filename]

    # Serialize per filename so only one worker does the check+upload dance
    with _image_lock_for(filename):
        # Re-check inside the lock — another worker may have finished while we waited
        if filename in _image_cache:
            logger.info("Image '%s' reusing cached ID %d", filename, _image_cache[filename]["id"])
            return _image_cache[filename]

        # Check WordPress media library
        existing = is_file_in_media_lib(site, filename)
        if existing:
            logger.info("Image '%s' already in media library (ID: %d)", filename, existing["id"])
            _image_cache[filename] = existing
            return existing

        # Download — semaphore caps concurrent orderboard requests
        with _orderboard_sem:
            try:
                img_resp = _retry(requests.get, full_url, timeout=60, label=f"download image {filename}")
                img_resp.raise_for_status()
            except Exception as e:
                logger.error("Failed to download image from '%s': %s", full_url, e)
                return None

        # Convert to WebP
        try:
            upload_bytes = _to_webp(img_resp.content, square_pad=square_pad)
        except Exception as e:
            logger.warning("WebP conversion failed for '%s', uploading original: %s", filename, e)
            upload_bytes = img_resp.content

        # Upload to WordPress media library
        headers = wp_auth_headers(site, "image/webp")
        headers["Content-Disposition"] = f'attachment; filename="{filename}"'
        try:
            res = _retry(requests.post,
                f"{site['url']}/wp-json/wp/v2/media",
                headers=headers,
                data=upload_bytes,
                timeout=120,
                label=f"upload image {filename}",
            )
            if res.status_code in (200, 201):
                media = res.json()
                _image_cache[filename] = media
                logger.info("Uploaded image '%s' (ID: %d)", filename, media["id"])
                return media
            logger.error("Failed to upload image '%s': %s", filename, res.text)
        except Exception as e:
            logger.error("Exception uploading image '%s': %s", filename, e)

    return None


# ---------------------------------------------------------------------------
# Product uploader
# ---------------------------------------------------------------------------
def upload_product(wcapi, site, woo_attrs, product_data, color_mappings, fit_mappings, catalog_colors, force=False, square_pad=False):
    """Create or update a variable product with all its variations."""
    name = product_data["name"]
    sku = product_data["sku"]

    if product_data.get("built") is False:
        logger.info("Skipping '%s' (built=false)", name)
        return

    variations = product_data.get("variations", [])
    if not variations:
        logger.info("Skipping '%s' (no variations)", name)
        return

    logger.info("=== Processing: %s (%s) — %d variations ===", name, sku, len(variations))

    # Build lookup maps for this product's variation attributes
    # color: sku -> {name, slug}  (slug is lowercased sku, e.g. "BLK" -> "blk")
    color_by_sku = {}
    for cm in color_mappings:
        color_by_sku[cm["sku"]] = {"name": cm["name"], "slug": cm["sku"].lower()}

    fit_by_sku = {}
    for fm in fit_mappings:
        fit_by_sku[fm["sku"]] = {"name": fm["name"], "slug": fm["sku"].lower()}

    # Collect unique values used by this product's variations
    colors_used = {}   # sku -> {name, slug}
    fits_used = {}
    sizes_used = []    # ordered list of unique sizes

    for v in variations:
        cs = v["colorSku"]
        if cs not in colors_used:
            colors_used[cs] = color_by_sku.get(cs, {"name": cs, "slug": cs.lower()})
        fs = v["fitSku"]
        if fs not in fits_used:
            fits_used[fs] = fit_by_sku.get(fs, {"name": fs, "slug": fs.lower()})
        sz = v["size"]
        if sz not in sizes_used:
            sizes_used.append(sz)

    # --- Ensure global attributes exist ---
    color_attr = ensure_global_attribute(wcapi, woo_attrs, "Color")
    size_attr = ensure_global_attribute(wcapi, woo_attrs, "Size")
    fit_attr = ensure_global_attribute(wcapi, woo_attrs, "Fit")

    # An attribute only needs to be a variation selector when it has more than one
    # unique value across this product's variations.  Single-value attributes are
    # still added to the parent as visible (informational) but non-variation fields.
    fit_is_var   = len(fits_used)   > 1
    color_is_var = len(colors_used) > 1
    size_is_var  = len(sizes_used)  > 1

    # Build the product-level attribute list — order: Fit → Color → Size
    # position is required so WooCommerce respects the order regardless of global attribute order
    attr_list = []
    _pos = 0
    if fit_attr:
        attr_list.append({
            "id": fit_attr["id"],
            "position": _pos,
            "visible": True,
            "variation": fit_is_var,
            "options": [f["name"] for f in fits_used.values()],
        })
        _pos += 1
    if color_attr:
        attr_list.append({
            "id": color_attr["id"],
            "position": _pos,
            "visible": True,
            "variation": color_is_var,
            "options": [c["name"] for c in colors_used.values()],
        })
        _pos += 1
    if size_attr:
        attr_list.append({
            "id": size_attr["id"],
            "position": _pos,
            "visible": True,
            "variation": size_is_var,
            "options": sizes_used,
        })

    # --- Ensure categories and tags ---
    category_ids = ensure_categories(wcapi, product_data.get("categories", []))
    tag_ids = ensure_tags(wcapi, product_data.get("tags", []))

    # --- Upload parent product image (first mockup of first variation) ---
    parent_images = []
    _first_mockups = variations[0].get("mockups") or variations[0].get("mockupUrls") or []
    if _first_mockups:
        _m = _first_mockups[0]
        first_mockup_url = _m["urlpath"] if isinstance(_m, dict) else _m
        media = upload_image_from_url(site, first_mockup_url, square_pad=square_pad)
        if media:
            parent_images.append({"id": media["id"]})

    # --- Create or update parent variable product ---
    parent_payload = {
        "name": name,
        "type": "variable",
        "sku": sku,
        "categories": category_ids,
        "tags": tag_ids,
        "attributes": attr_list,
        "images": parent_images,
    }

    existing_products = fetch_paginated(wcapi, f"products?sku={sku}")
    if existing_products:
        product_id = existing_products[0]["id"]
        if force:
            resp = _retry(wcapi.delete, f"products/{product_id}", params={"force": True}, label=f"delete product {name}")
            if resp.status_code not in (200, 201):
                logger.error("Failed to delete '%s' for re-upload: %s", name, resp.text)
                return
            logger.info("Deleted product '%s' (ID: %d) for re-upload", name, product_id)
        else:
            resp = _retry(wcapi.put, f"products/{product_id}", parent_payload, label=f"update product {name}")
            if resp.status_code == 200:
                logger.info("Updated parent product '%s' (ID: %d)", name, product_id)
            else:
                logger.error("Failed to update parent product '%s': %s", name, resp.text)
                return

    if not existing_products or force:
        resp = _retry(wcapi.post, "products", parent_payload, label=f"create product {name}")
        if resp.status_code == 201:
            product_id = resp.json()["id"]
            logger.info("Created parent product '%s' (ID: %d)", name, product_id)
        else:
            logger.error("Failed to create parent product '%s': %s", name, resp.text)
            return

    # --- Fetch existing variations on the server ---
    existing_variations = fetch_paginated(wcapi, f"products/{product_id}/variations")
    existing_by_sku = {v["sku"]: v for v in existing_variations}
    remaining_on_server = dict(existing_by_sku)  # track which ones to potentially delete

    create_list = []
    update_list = []

    for v in variations:
        v_sku = v["sku"]
        color_info = colors_used[v["colorSku"]]
        fit_info = fits_used[v["fitSku"]]
        size = v["size"]
        price = v["price"]

        # Resolve catalog color info for blank metadata
        cat_color = catalog_colors.get(str(v.get("catalogColorId", "")), {})
        blank_meta = {
            "id": cat_color.get("catalogStyleNumber", ""),
            "brandName": cat_color.get("catalogStyleBrand", ""),
            "description": cat_color.get("catalogStyleName", ""),
            "color": cat_color.get("catalogColorName", ""),
            "size": size,
        }

        # Build variation-level attribute options — only include multi-value attributes
        var_attrs = []
        if fit_attr and fit_is_var:
            var_attrs.append({"id": fit_attr["id"], "option": fit_info["name"]})
        if color_attr and color_is_var:
            var_attrs.append({"id": color_attr["id"], "option": color_info["name"]})
        if size_attr and size_is_var:
            var_attrs.append({"id": size_attr["id"], "option": size})

        # Upload variation mockup image (supports both {urlpath} objects and plain URL strings)
        var_image = None
        for mockup in v.get("mockups", v.get("mockupUrls", [])):
            mockup_url = mockup["urlpath"] if isinstance(mockup, dict) else mockup
            media = upload_image_from_url(site, mockup_url, square_pad=square_pad)
            if media:
                var_image = {"id": media["id"]}
                break

        var_payload = {
            "sku": v_sku,
            "regular_price": f"{float(price):.2f}",
            "attributes": var_attrs,
            "meta_data": [
                {"key": "blank", "value": blank_meta},
            ],
        }
        if var_image:
            var_payload["image"] = var_image

        if v_sku in existing_by_sku:
            var_payload["id"] = existing_by_sku[v_sku]["id"]
            update_list.append(var_payload)
            remaining_on_server.pop(v_sku, None)
        else:
            create_list.append(var_payload)

    # Variations on server but not in JSON are deleted
    delete_ids = [v["id"] for v in remaining_on_server.values()]

    # --- Batch upload in chunks of 100 ---
    def _chunked(lst, size=100):
        for i in range(0, len(lst), size):
            yield lst[i: i + size]

    for chunk in _chunked(create_list):
        resp = _retry(wcapi.post, f"products/{product_id}/variations/batch", {"create": chunk}, label=f"batch create variations {name}")
        if resp.status_code != 200:
            logger.error("Variation batch create failed for '%s': %s", name, resp.text)
        else:
            logger.info("Batch created %d variations for '%s'", len(chunk), name)

    for chunk in _chunked(update_list):
        resp = _retry(wcapi.post, f"products/{product_id}/variations/batch", {"update": chunk}, label=f"batch update variations {name}")
        if resp.status_code != 200:
            logger.error("Variation batch update failed for '%s': %s", name, resp.text)
        else:
            logger.info("Batch updated %d variations for '%s'", len(chunk), name)

    if delete_ids:
        for chunk in _chunked(delete_ids):
            resp = _retry(wcapi.post,
                f"products/{product_id}/variations/batch",
                {"delete": chunk},
                label=f"batch delete variations {name}",
            )
            if resp.status_code != 200:
                logger.error("Variation batch delete failed for '%s': %s", name, resp.text)
            else:
                logger.info("Batch deleted %d stale variations for '%s'", len(chunk), name)

    logger.info(
        "Done '%s': %d created, %d updated, %d deleted",
        name, len(create_list), len(update_list), len(delete_ids),
    )


# ---------------------------------------------------------------------------
# Post-upload: reorder sizes + update color swatches
# ---------------------------------------------------------------------------
def reorder_sizes(wcapi):
    """Set menu_order on Size attribute terms to match SIZES_ORDER."""
    all_attrs = fetch_paginated(wcapi, "products/attributes")
    size_attr = next((a for a in all_attrs if a["name"].lower() == "size"), None)
    if not size_attr:
        logger.warning("Size attribute not found, skipping size reordering.")
        return

    terms = fetch_paginated(wcapi, f"products/attributes/{size_attr['id']}/terms")
    for term in terms:
        try:
            menu_order = SIZES_ORDER.index(term["name"].upper()) + 1
        except ValueError:
            menu_order = 99

        if term.get("menu_order") != menu_order:
            resp = _retry(wcapi.put,
                f"products/attributes/{size_attr['id']}/terms/{term['id']}",
                {"menu_order": menu_order},
                label=f"reorder size {term['name']}",
            )
            if resp.status_code != 200:
                logger.error("Failed to reorder size '%s': %s", term["name"], resp.text)
            else:
                logger.info("Set size '%s' order to %d", term["name"], menu_order)


def update_color_swatches(wcapi, site, color_mappings):
    """
    Push RGB swatch values to the Color attribute terms using the
    custom /wp-json/terms/v1/metadata endpoint.
    """
    all_attrs = fetch_paginated(wcapi, "products/attributes")
    color_attr = next((a for a in all_attrs if a["name"].lower() == "color"), None)
    if not color_attr:
        logger.warning("Color attribute not found, skipping swatch update.")
        return

    color_terms = fetch_paginated(wcapi, f"products/attributes/{color_attr['id']}/terms")
    # Build a lookup from slug -> swatch rgb list
    swatch_by_slug = {cm["sku"].lower(): cm.get("rgb", []) for cm in color_mappings}

    headers = wp_auth_headers(site)
    headers["Content-Type"] = "application/json"
    url = f"{site['url']}/wp-json/terms/v1/metadata"

    for term in color_terms:
        rgb = swatch_by_slug.get(term["slug"])
        if not rgb:
            logger.info("No swatch definition for color '%s' (slug: %s), skipping.", term["name"], term["slug"])
            continue

        payload = {
            "id": term["id"],
            "product_attribute_color": rgb[0],
            "is_dual_color": "yes" if len(rgb) > 1 else "no",
            "secondary_color": rgb[1] if len(rgb) > 1 else "",
        }
        resp = _retry(requests.put, url, headers=headers, data=json.dumps(payload), timeout=30, label=f"update swatch {term['name']}")
        if resp.status_code != 200:
            logger.error("Failed to update swatch for '%s': %s", term["name"], resp.text)
        else:
            logger.info("Updated swatch for '%s': %s", term["name"], rgb)


# ---------------------------------------------------------------------------
# Store audit + fix
# ---------------------------------------------------------------------------
def _audit_product(wcapi, expected_product, wc_product):
    """
    Compare one expected product against its WooCommerce counterpart.
    Returns {"issues": [...], "warnings": [...]} where issues are definite
    problems and warnings are informational (e.g. extra variations).
    """
    issues = []
    warnings = []

    expected_variations = expected_product.get("variations", [])

    # Variation count — collected below after per-variation checks
    wc_var_ids = wc_product.get("variations", [])

    # Categories — flatten expected paths ("A > B > C") into individual names
    expected_cat_names = set()
    for path in expected_product.get("categories", []):
        for part in path.split(">"):
            part = part.strip()
            if part:
                expected_cat_names.add(part.lower())
    wc_cat_names = {c["name"].lower() for c in wc_product.get("categories", [])}
    missing_cats = expected_cat_names - wc_cat_names
    if missing_cats:
        issues.append(f"Missing categories: {', '.join(sorted(missing_cats))}")

    # Tags
    expected_tag_names = {t.lower() for t in expected_product.get("tags", [])}
    wc_tag_names = {t["name"].lower() for t in wc_product.get("tags", [])}
    missing_tags = expected_tag_names - wc_tag_names
    if missing_tags:
        issues.append(f"Missing tags: {', '.join(sorted(missing_tags))}")

    # Parent image
    if not wc_product.get("images"):
        issues.append("Parent product has no image")

    # Per-variation checks
    product_id = wc_product["id"]
    wc_variations = fetch_paginated(wcapi, f"products/{product_id}/variations")
    wc_var_by_sku = {v["sku"].strip().upper(): v for v in wc_variations if v.get("sku")}

    expected_var_skus = set()
    missing_var_skus = []
    vars_missing_image = []

    for ev in expected_variations:
        ev_sku = ev["sku"].strip().upper()
        expected_var_skus.add(ev_sku)
        if ev_sku not in wc_var_by_sku:
            missing_var_skus.append(ev["sku"])
        else:
            img = wc_var_by_sku[ev_sku].get("image") or {}
            if not img.get("id"):
                vars_missing_image.append(ev["sku"])

    extra_var_skus = sorted(sku for sku in wc_var_by_sku if sku not in expected_var_skus)

    # Variation comparison block — always emit when counts differ or SKUs diverge
    if len(wc_var_ids) != len(expected_variations) or missing_var_skus or extra_var_skus:
        var_lines = [f"Variations: expected {len(expected_variations)}, found {len(wc_var_ids)}"]
        if missing_var_skus:
            var_lines.append(
                f"  In orderboard, not on site ({len(missing_var_skus)}): "
                + ", ".join(missing_var_skus)
            )
        else:
            var_lines.append("  In orderboard, not on site: (none)")
        if extra_var_skus:
            var_lines.append(
                f"  On site, not in orderboard ({len(extra_var_skus)}): "
                + ", ".join(extra_var_skus)
            )
        else:
            var_lines.append("  On site, not in orderboard: (none)")
        issues.append("\n".join(var_lines))

    if vars_missing_image:
        issues.append(
            f"Variations missing image ({len(vars_missing_image)}/{len(wc_variations)}): "
            + ", ".join(vars_missing_image)
        )

    return {"issues": issues, "warnings": warnings}


def _gather_audit_data(wcapi, data):
    """
    Fetch all WC products and compare against expected orderboard data.
    Returns a dict with keys: expected, complete, incomplete, missing, extraneous.
    """
    products = data.get("products", [])
    expected = [p for p in products if p.get("built") and p.get("variations")]
    expected_by_sku = {p["sku"].strip().upper(): p for p in expected}

    logger.info("Fetching all WooCommerce products...")
    wc_products = fetch_paginated(wcapi, "products")
    wc_by_sku = {p["sku"].strip().upper(): p for p in wc_products if p.get("sku")}

    logger.info(
        "Auditing %d expected products against %d WooCommerce products...",
        len(expected), len(wc_products),
    )

    complete = []
    incomplete = []  # list of (expected_product, wc_product, audit_result)
    missing = []     # expected but absent from WC
    extraneous = []  # in WC but not in expected set

    for ep in expected:
        sku = ep["sku"].strip().upper()
        if sku not in wc_by_sku:
            missing.append(ep)
            logger.info("MISSING  : %s (%s)", ep["name"], ep["sku"])
        else:
            wp = wc_by_sku[sku]
            result = _audit_product(wcapi, ep, wp)
            if result["issues"] or result["warnings"]:
                incomplete.append((ep, wp, result))
                logger.info(
                    "INCOMPLETE: %s (%s) — %d issue(s), %d warning(s)",
                    ep["name"], ep["sku"], len(result["issues"]), len(result["warnings"]),
                )
            else:
                complete.append(ep)
                logger.info("OK       : %s (%s)", ep["name"], ep["sku"])

    for wc_sku, wp in wc_by_sku.items():
        if wc_sku not in expected_by_sku:
            extraneous.append(wp)

    return {
        "expected": expected,
        "complete": complete,
        "incomplete": incomplete,
        "missing": missing,
        "extraneous": extraneous,
    }


def _parse_audit_skus(filepath):
    """
    Parse an audit report and return the set of SKUs that were INCOMPLETE or MISSING.
    These are the only products the targeted fix needs to touch.

    Report structure uses === rules as section dividers:
        ===...===
        SECTION HEADER
        ===...===
        content lines
    """
    import re
    skus = set()
    TARGET_SECTIONS = {"INCOMPLETE PRODUCTS", "MISSING PRODUCTS"}
    # State: after a === line we expect a header; after the header we expect another ===
    # then content lines until the next === line.
    prev_was_rule = False
    in_target = False
    header_seen = False
    try:
        with open(filepath) as f:
            for line in f:
                line = line.rstrip()
                if line.startswith("="):
                    if in_target and header_seen:
                        # Second === after the header ends this section's content
                        in_target = False
                        header_seen = False
                    prev_was_rule = True
                    continue
                if prev_was_rule:
                    # This line is a section header
                    in_target = any(t in line for t in TARGET_SECTIONS)
                    header_seen = False
                    prev_was_rule = False
                    continue
                if in_target and not header_seen:
                    # The line right after the header is the closing ===, handled above.
                    # After that closing === we start collecting SKUs; flag it.
                    header_seen = True
                    continue
                if in_target:
                    # Product lines: "  [SKU] Name  (WC ID: 123)"  or  "  - [SKU] Name"
                    # Only match lines where [TOKEN] appears at the start of content
                    m = re.match(r'\s+(?:-\s+)?\[([^\]!?]+)\]', line)
                    if m:
                        skus.add(m.group(1).strip().upper())
    except Exception as e:
        logger.warning("Could not parse audit SKUs from '%s': %s", filepath, e)
    return skus


def _parse_audit_metadata(filepath):
    """
    Read connection metadata written into a previous audit/fix report header.
    Returns a dict; keys present only when a non-empty, non-N/A value was found.
    """
    field_map = {
        "store id":    "store_id",
        "orderboard":  "orderboard_url",
        "source":      "source",
    }
    meta = {}
    try:
        with open(filepath) as f:
            in_header = False
            for line in f:
                line = line.rstrip()
                if line.startswith("="):
                    in_header = True
                    continue
                if in_header and line == "":
                    break  # blank line ends the header block
                if " : " in line:
                    raw_key, _, val = line.partition(" : ")
                    key = raw_key.strip().lower()
                    val = val.strip()
                    mapped = field_map.get(key)
                    if mapped and val and val != "N/A":
                        meta[mapped] = val
    except Exception as e:
        logger.warning("Could not parse audit file '%s': %s", filepath, e)
    return meta


def _write_report(
    site,
    gathered,
    output_file,
    title="STORE AUDIT REPORT",
    fix_sections=None,
    source_label="",
    orderboard_store_id="",
    orderboard_url="",
):
    """Render and write the audit/fix report to output_file."""
    W = 72
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    expected = gathered["expected"]
    complete = gathered["complete"]
    incomplete = gathered["incomplete"]
    missing = gathered["missing"]
    extraneous = gathered["extraneous"]

    def rule(char="="):
        return char * W

    lines = [
        rule(),
        title,
        rule(),
        f"Generated : {now}",
        f"Site      : {SITE_ID}",
        f"URL       : {site.get('url', 'unknown')}",
        f"Source    : {source_label or 'unknown'}",
        f"Store ID  : {orderboard_store_id or 'N/A'}",
        f"Orderboard: {orderboard_url or 'N/A'}",
        "",
        "SUMMARY",
        rule("-"),
        f"Expected products (built)  : {len(expected)}",
        f"  [OK]      Complete       : {len(complete)}",
        f"  [WARN]    Incomplete     : {len(incomplete)}",
        f"  [MISSING] Not in WC      : {len(missing)}",
        f"Extraneous in WooCommerce  : {len(extraneous)}",
        "",
    ]

    if fix_sections:
        lines.extend(fix_sections)

    if missing:
        lines += [
            rule(),
            f"MISSING PRODUCTS ({len(missing)})  --  expected but not found in WooCommerce",
            rule(),
        ]
        for p in missing:
            lines.append(f"  - [{p['sku']}] {p['name']}")
            lines.append(f"      Expected variations : {len(p['variations'])}")
            if p.get("categories"):
                lines.append(f"      Categories          : {', '.join(p['categories'])}")
            if p.get("tags"):
                lines.append(f"      Tags                : {', '.join(p['tags'])}")
        lines.append("")

    if incomplete:
        lines += [
            rule(),
            f"INCOMPLETE PRODUCTS ({len(incomplete)})  --  found but have issues",
            rule(),
        ]
        for ep, wp, result in incomplete:
            lines.append(f"  [{ep['sku']}] {ep['name']}  (WC ID: {wp['id']})")
            for issue in result["issues"]:
                parts = issue.split("\n")
                lines.append(f"      [!] {parts[0]}")
                for part in parts[1:]:
                    lines.append(f"          {part}")
            for warn in result["warnings"]:
                parts = warn.split("\n")
                lines.append(f"      [?] {parts[0]}")
                for part in parts[1:]:
                    lines.append(f"          {part}")
        lines.append("")

    if extraneous:
        lines += [
            rule(),
            f"EXTRANEOUS PRODUCTS ({len(extraneous)})  --  in WooCommerce but not in orderboard",
            rule(),
        ]
        for wp in extraneous:
            status = wp.get("status", "unknown")
            var_count = len(wp.get("variations", []))
            has_image = "yes" if wp.get("images") else "no"
            lines.append(
                f"  - [{wp['sku']}] {wp['name']}"
                f"  (WC ID: {wp['id']}, status: {status},"
                f" variations: {var_count}, image: {has_image})"
            )
        lines.append("")

    lines += [
        rule(),
        f"COMPLETE PRODUCTS ({len(complete)})",
        rule(),
    ]
    if complete:
        for p in complete:
            lines.append(f"  - [{p['sku']}] {p['name']}")
    else:
        lines.append("  (none)")
    lines.append("")

    with open(output_file, "w") as f:
        f.write("\n".join(lines))
    logger.info("Report written to '%s'", output_file)


def audit_store(wcapi, site, data, output_file,
                source_label="", orderboard_store_id="", orderboard_url=""):
    """Audit the WooCommerce store and write a report. Read-only."""
    gathered = _gather_audit_data(wcapi, data)
    _write_report(
        site, gathered, output_file,
        source_label=source_label,
        orderboard_store_id=orderboard_store_id,
        orderboard_url=orderboard_url,
    )
    logger.info(
        "Summary: %d complete, %d incomplete, %d missing, %d extraneous",
        len(gathered["complete"]), len(gathered["incomplete"]),
        len(gathered["missing"]), len(gathered["extraneous"]),
    )


def fix_store(wcapi, site, data, woo_attrs, color_mappings, fit_mappings, catalog_colors, output_file,
              source_label="", orderboard_store_id="", orderboard_url="", filter_skus=None):
    """
    Audit the store, then for each product with hard issues delete it from
    WooCommerce and re-upload it fresh. Missing products are uploaded normally.
    Products with warnings only (e.g. extra variations) are skipped.
    Extraneous products are reported but never auto-deleted.

    filter_skus: if provided, only fix products whose SKU is in this set.
    """
    gathered = _gather_audit_data(wcapi, data)

    if filter_skus:
        gathered["incomplete"] = [
            (ep, wp, r) for ep, wp, r in gathered["incomplete"]
            if ep["sku"].strip().upper() in filter_skus
        ]
        gathered["missing"] = [
            ep for ep in gathered["missing"]
            if ep["sku"].strip().upper() in filter_skus
        ]
        logger.info(
            "Filtering fix to %d SKU(s) from audit report: %d incomplete, %d missing",
            len(filter_skus), len(gathered["incomplete"]), len(gathered["missing"]),
        )

    W = 72
    def rule(char="="): return char * W

    # Split incomplete into hard-issue products vs warning-only
    to_fix = [(ep, wp, r) for ep, wp, r in gathered["incomplete"] if r["issues"]]
    warn_only = [(ep, wp, r) for ep, wp, r in gathered["incomplete"] if not r["issues"]]

    fixed = []
    uploaded_new = []
    failed = []
    fix_lines = [rule(), "FIX ACTIONS", rule()]

    # --- Delete + re-upload incomplete products ---
    if to_fix:
        fix_lines.append(f"Re-uploading {len(to_fix)} incomplete product(s):")
    for ep, wp, _audit_result in to_fix:
        product_id = wp["id"]
        logger.info("Deleting '%s' (WC ID: %d) for re-upload...", ep["name"], product_id)
        resp = _retry(
            wcapi.delete, f"products/{product_id}",
            params={"force": True},
            label=f"delete {ep['sku']}",
        )
        if resp.status_code not in (200, 201):
            logger.error("Failed to delete '%s': HTTP %d — %s", ep["name"], resp.status_code, resp.text)
            failed.append((ep, f"delete failed: HTTP {resp.status_code}"))
            fix_lines.append(f"  [FAIL]    [{ep['sku']}] {ep['name']} — delete failed HTTP {resp.status_code}")
            continue
        try:
            upload_product(wcapi, site, woo_attrs, ep, color_mappings, fit_mappings, catalog_colors)
            fixed.append(ep)
            fix_lines.append(f"  [FIXED]   [{ep['sku']}] {ep['name']}")
            logger.info("Re-uploaded '%s' successfully.", ep["name"])
        except Exception as e:
            logger.error("Re-upload failed for '%s': %s", ep["name"], e)
            failed.append((ep, f"re-upload failed: {e}"))
            fix_lines.append(f"  [FAIL]    [{ep['sku']}] {ep['name']} — re-upload failed: {e}")

    # --- Upload missing products ---
    if gathered["missing"]:
        fix_lines.append(f"Uploading {len(gathered['missing'])} missing product(s):")
    for ep in gathered["missing"]:
        logger.info("Uploading missing product '%s'...", ep["name"])
        try:
            upload_product(wcapi, site, woo_attrs, ep, color_mappings, fit_mappings, catalog_colors)
            uploaded_new.append(ep)
            fix_lines.append(f"  [UPLOADED] [{ep['sku']}] {ep['name']}")
            logger.info("Uploaded '%s' successfully.", ep["name"])
        except Exception as e:
            logger.error("Upload failed for '%s': %s", ep["name"], e)
            failed.append((ep, f"upload failed: {e}"))
            fix_lines.append(f"  [FAIL]     [{ep['sku']}] {ep['name']} — upload failed: {e}")

    # --- Warning-only: skip ---
    if warn_only:
        fix_lines.append(f"Skipped {len(warn_only)} product(s) with warnings only (no hard issues):")
        for ep, wp, _ in warn_only:
            fix_lines.append(f"  [SKIP]    [{ep['sku']}] {ep['name']}")

    if not to_fix and not gathered["missing"] and not warn_only:
        fix_lines.append("  Nothing to fix — store is complete.")

    fix_lines += [
        "",
        f"Fix result: {len(fixed)} re-uploaded, {len(uploaded_new)} newly uploaded,"
        f" {len(failed)} failed, {len(warn_only)} skipped (warnings only)",
        "",
    ]

    _write_report(
        site, gathered, output_file,
        title="STORE AUDIT + FIX REPORT",
        fix_sections=fix_lines,
        source_label=source_label,
        orderboard_store_id=orderboard_store_id,
        orderboard_url=orderboard_url,
    )
    logger.info(
        "Fix complete: %d re-uploaded, %d newly uploaded, %d failed,"
        " %d extraneous (not auto-deleted)",
        len(fixed), len(uploaded_new), len(failed), len(gathered["extraneous"]),
    )


# Number of products to upload in parallel
MAX_WORKERS = 8


def preflight(wcapi, data):
    """
    Create all global attributes and attribute terms needed by every product
    before any upload threads start, so workers never race to create the same
    term simultaneously.

    Returns the refreshed woo_attrs list.
    """
    color_mappings = data.get("colorMappings", [])
    fit_mappings = data.get("fitMappings", [])
    products = data.get("products", [])

    woo_attrs = fetch_paginated(wcapi, "products/attributes")

    color_attr = ensure_global_attribute(wcapi, woo_attrs, "Color")
    size_attr = ensure_global_attribute(wcapi, woo_attrs, "Size")
    fit_attr = ensure_global_attribute(wcapi, woo_attrs, "Fit")

    # Collect every color / size / fit used across all built products
    all_colors = {}   # sku -> {name, slug}
    all_fits = {}
    all_sizes = set()

    color_by_sku = {cm["sku"]: {"name": cm["name"], "slug": cm["sku"].lower()} for cm in color_mappings}
    fit_by_sku = {fm["sku"]: {"name": fm["name"], "slug": fm["sku"].lower()} for fm in fit_mappings}

    for p in products:
        if p.get("built") is False or not p.get("variations"):
            continue
        for v in p["variations"]:
            cs = v["colorSku"]
            if cs not in all_colors:
                all_colors[cs] = color_by_sku.get(cs, {"name": cs, "slug": cs.lower()})
            fs = v["fitSku"]
            if fs not in all_fits:
                all_fits[fs] = fit_by_sku.get(fs, {"name": fs, "slug": fs.lower()})
            if v.get("size"):
                all_sizes.add(v["size"])

    if color_attr:
        ensure_attribute_terms(wcapi, color_attr["id"],
                               [{"name": c["name"], "slug": c["slug"]} for c in all_colors.values()])
    if size_attr:
        ensure_attribute_terms(wcapi, size_attr["id"],
                               [{"name": sz, "slug": sz.lower()} for sz in all_sizes])
    if fit_attr:
        ensure_attribute_terms(wcapi, fit_attr["id"],
                               [{"name": f["name"], "slug": f["slug"]} for f in all_fits.values()])

    logger.info("Preflight complete: Color / Size / Fit attributes and terms are ready.")
    return fetch_paginated(wcapi, "products/attributes")


# ---------------------------------------------------------------------------
# Orderboard API fetch
# ---------------------------------------------------------------------------
def _graphql(url: str, token: str, query: str, variables: dict) -> dict:
    """Execute a single GraphQL request against the orderboard API."""
    resp = requests.post(
        f"{url}/api/graphql",
        json={"query": query, "variables": variables},
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        timeout=30,
    )
    resp.raise_for_status()
    result = resp.json()
    if result.get("errors"):
        raise RuntimeError(f"GraphQL errors: {result['errors']}")
    return result["data"]


def _build_woo_export(raw: dict) -> dict:
    """
    Python port of buildWooCommerceExport() from src/web/utils/wooCommerceExport.ts.
    Joins designer mappings with built Product/ProductVariation records to produce
    the same flat variation list that products.json contains.
    """
    store = raw.get("store", {})
    sku_prefix = store.get("skuPrefix") or ""

    product_by_id = {p["id"]: p for p in raw.get("designerProducts", [])}
    group_by_id = {g["id"]: g for g in raw.get("designGroups", [])}
    built_by_sku = {
        p["productSku"].strip().upper(): p
        for p in raw.get("products", [])
        if p.get("productSku")
    }

    # colorMappings: collapse rgb1/rgb2/rgb3 → rgb list
    color_mappings = []
    for c in raw.get("colorMappings", []):
        rgb = [v for v in [c.get("rgb1"), c.get("rgb2"), c.get("rgb3")] if v]
        color_mappings.append({"id": c["id"], "name": c["name"], "sku": c["sku"], "rgb": rgb})

    fit_mappings = [
        {"id": f["id"], "name": f["name"], "sku": f["sku"], "description": f.get("description")}
        for f in raw.get("fitMappings", [])
    ]

    catalog_colors = []
    seen_catalog_color_ids = set()
    products = []

    def _add_catalog_color(v: dict):
        sc = v.get("styleColor") or {}
        cid = sc.get("catalogColorId")
        if cid is None or cid in seen_catalog_color_ids:
            return
        seen_catalog_color_ids.add(cid)
        cs = sc.get("catalogStyle") or {}
        cc = sc.get("catalogColor") or {}
        catalog_colors.append({
            "catalogColorId": cid,
            "catalogStyleId": sc.get("catalogStyleId"),
            "catalogStyleNumber": cs.get("styleId"),
            "catalogStyleName": cs.get("name"),
            "catalogStyleBrand": cs.get("brandName"),
            "catalogColorName": cc.get("name"),
        })

    def _map_variation(v: dict, use_mockup_urls: bool = False) -> dict:
        sc = v.get("styleColor") or {}
        _add_catalog_color(v)
        if use_mockup_urls:
            mockups = [
                {"view": m.get("viewName") or "Default", "urlpath": m.get("url") or ""}
                for m in (v.get("mockupUrls") or [])
            ]
        else:
            mockups = [
                {"view": (m.get("view") or {}).get("name") or "Default", "urlpath": m.get("url") or ""}
                for m in (sc.get("mockupAssignments") or [])
            ]
        return {
            "sku": v.get("sku") or "",
            "size": (v.get("catalogSize") or {}).get("name"),
            "fitSku": (v.get("mappedFit") or {}).get("sku") or "",
            "colorSku": sc.get("mappedColor", {}).get("sku") or "" if sc.get("mappedColor") else "",
            "catalogColorId": sc.get("catalogColorId"),
            "price": v.get("price"),
            "mockups": mockups,
        }

    # Designer-mapped products
    designer_skus = set()
    for mapping in raw.get("designGroupProductMappings", []):
        group = group_by_id.get(mapping["designGroupId"])
        product = product_by_id.get(mapping["designerProductId"])
        if not group or not product:
            continue

        group_sku_part = group.get("sku") or group["name"]
        product_sku = f"{sku_prefix}-{group_sku_part}-{product['sku']}"
        designer_skus.add(product_sku.strip().upper())

        built = built_by_sku.get(product_sku.strip().upper())

        export_variations = []
        if built and built.get("variations"):
            sorted_vars = sorted(built["variations"], key=lambda v: v.get("sizeOrder") or 0)
            export_variations = [_map_variation(v) for v in sorted_vars]

        products.append({
            "name": f"{group['name']} {product['name']}",
            "sku": product_sku,
            "categories": product.get("categories") or [],
            "tags": product.get("tags") or [],
            "built": bool(built),
            "variations": export_variations,
        })

    # Manual products (built products not linked to any designer mapping)
    for mp in raw.get("products", []):
        if not mp.get("productSku"):
            continue
        if mp["productSku"].strip().upper() in designer_skus:
            continue
        sorted_vars = sorted(mp.get("variations") or [], key=lambda v: v.get("sizeOrder") or 0)
        products.append({
            "name": mp.get("name") or mp["productSku"],
            "sku": mp["productSku"],
            "categories": [],
            "tags": [],
            "built": True,
            "variations": [_map_variation(v, use_mockup_urls=True) for v in sorted_vars],
        })

    logger.info(
        "Export assembled: %d products, %d color mappings, %d fit mappings, %d catalog colors",
        len(products), len(color_mappings), len(fit_mappings), len(catalog_colors),
    )
    return {
        "store": {"name": store.get("name", ""), "skuPrefix": sku_prefix},
        "colorMappings": color_mappings,
        "fitMappings": fit_mappings,
        "catalogColors": catalog_colors,
        "products": products,
    }


def fetch_from_orderboard(api_url: str, email: str, password: str, store_id: str) -> dict:
    """
    Log in to orderboard, run the same export query that WooCommerceExportModal uses,
    and return a dict in the same shape as products.json.
    """
    # Step 1: authenticate
    logger.info("Authenticating with orderboard at %s ...", api_url)
    login_data = _graphql(api_url, "", """
        mutation Login($email: String!, $password: String!) {
          login(email: $email, password: $password) { token }
        }
    """, {"email": email, "password": password})
    token = login_data["login"]["token"]
    logger.info("Authenticated successfully.")

    # Step 2: run the full export query (mirrors GET_EXPORT_DATA in WooCommerceExportModal)
    logger.info("Fetching export data for store %s ...", store_id)
    raw = _graphql(api_url, token, f"""
        query GetWooExport($storeId: ID!) {{
          store(id: $storeId) {{ id name skuPrefix }}
          designGroups(storeId: $storeId) {{ id name sku }}
          colorMappings(storeId: $storeId) {{ id name sku rgb1 rgb2 rgb3 }}
          fitMappings(storeId: $storeId) {{ id name sku description }}
          designerProducts(storeId: $storeId) {{ id name sku categories tags variations }}
          designGroupProductMappings(storeId: $storeId) {{
            id designGroupId designerProductId variationSkus colorPlacements
          }}
          products(storeId: $storeId) {{
            id name productSku
            variations {{
              sku price sizeOrder
              mappedFit {{ name sku }}
              catalogSize {{ name }}
              mockupUrls {{ url viewName }}
              styleColor {{
                catalogStyleId catalogColorId
                mappedColor {{ name sku }}
                catalogStyle {{ styleId name brandName }}
                catalogColor {{ name }}
                mockupAssignments {{ url(width: {IMAGE_MAX_WIDTH}) view {{ name }} }}
              }}
            }}
          }}
        }}
    """, {"storeId": store_id})

    # Step 3: assemble into products.json-compatible structure
    return _build_woo_export(raw)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
def main():
    global SITE_ID
    parser = argparse.ArgumentParser(description="Upload products to a WooCommerce store.")
    parser.add_argument(
        "site_id",
        nargs="?",
        default=os.environ.get("SITE_ID", "unknown"),
        help="Site slug/ID from the database server (overrides SITE_ID env var)",
    )
    parser.add_argument(
        "--api",
        action="store_true",
        help="Fetch products from the orderboard API instead of a local products.json file",
    )
    parser.add_argument(
        "--orderboard-url",
        default=ORDERBOARD_API_URL,
        help="Orderboard base URL (e.g. https://myapp.railway.app). Also set via ORDERBOARD_API_URL env var.",
    )
    parser.add_argument(
        "--store-id",
        default=ORDERBOARD_STORE_ID,
        help="Orderboard store ID to fetch products for. Also set via ORDERBOARD_STORE_ID env var.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Delete existing products before re-uploading instead of updating them in place",
    )
    parser.add_argument(
        "--audit",
        action="store_true",
        help="Audit the store instead of uploading — checks product completeness and flags extraneous items",
    )
    parser.add_argument(
        "--audit-file",
        default=None,
        metavar="FILE",
        help="Output path for the audit report (default: audit_<site_id>_<timestamp>.txt)",
    )
    parser.add_argument(
        "--fix",
        action="store_true",
        help="Audit then fix: delete and re-upload any incomplete or missing products",
    )
    parser.add_argument(
        "--fix-file",
        default=None,
        metavar="FILE",
        help="Output path for the fix report (default: fix_<site_id>_<timestamp>.txt)",
    )
    parser.add_argument(
        "--from-audit",
        default=None,
        metavar="FILE",
        help="Read orderboard Store ID and URL from a previous audit/fix report; CLI args override",
    )
    parser.add_argument(
        "--square-pad",
        action="store_true",
        help="Center each image on a square canvas (longest side) before uploading",
    )
    parser.add_argument(
        "--filter-skus",
        default=None,
        metavar="SKUS",
        help="Comma-separated SKUs to upload; omit to upload all built products",
    )
    args = parser.parse_args()
    SITE_ID = args.site_id

    # --from-audit: load saved connection metadata as defaults; CLI args take precedence
    if args.from_audit:
        saved = _parse_audit_metadata(args.from_audit)
        if saved.get("store_id") and not args.store_id:
            args.store_id = saved["store_id"]
            logger.info("Using Store ID from audit file: %s", args.store_id)
        if saved.get("orderboard_url") and args.orderboard_url == ORDERBOARD_API_URL:
            args.orderboard_url = saved["orderboard_url"]
            logger.info("Using Orderboard URL from audit file: %s", args.orderboard_url)
        # If the audit was run with --api, default to API mode for fix too
        if saved.get("source", "").startswith("orderboard API") and not args.api:
            args.api = True
            logger.info("Defaulting to --api mode based on audit file source.")

    # --store-id is only meaningful with --api; treat its presence as implying --api
    if args.store_id and not args.api:
        args.api = True
        logger.info("Defaulting to --api mode because --store-id is set.")

    _, site = load_site_config()

    if args.api:
        api_url = args.orderboard_url
        store_id = args.store_id
        email = ORDERBOARD_EMAIL
        password = ORDERBOARD_PASSWORD
        if not api_url:
            logger.error("--orderboard-url (or ORDERBOARD_API_URL env var) is required with --api")
            sys.exit(1)
        if not store_id:
            logger.error("--store-id (or ORDERBOARD_STORE_ID env var) is required with --api")
            sys.exit(1)
        if not email:
            if not sys.stdin.isatty():
                logger.error("ORDERBOARD_EMAIL env var is required (no TTY available for interactive prompt)")
                sys.exit(1)
            email = input("Orderboard email: ").strip()
        if not password:
            if not sys.stdin.isatty():
                logger.error("ORDERBOARD_PASSWORD env var is required (no TTY available for interactive prompt)")
                sys.exit(1)
            password = getpass.getpass("Orderboard password: ")
        data = fetch_from_orderboard(api_url, email, password, store_id)
        source_label = f"orderboard API (store: {store_id})"
        ob_store_id = store_id
        ob_url = api_url
    else:
        products_file = PRODUCTS_FILE
        if not os.path.isfile(products_file):
            logger.error("Products file not found: %s", products_file)
            sys.exit(1)
        with open(products_file) as f:
            data = json.load(f)
        logger.info("Loaded products from '%s'", products_file)
        source_label = products_file
        ob_store_id = ""
        ob_url = ""

    color_mappings = data.get("colorMappings", [])
    fit_mappings = data.get("fitMappings", [])
    catalog_colors = {str(c["catalogColorId"]): c for c in data.get("catalogColors", [])}
    products = data.get("products", [])

    logger.info("Products: %d  Site: %s  URL: %s", len(products), SITE_ID, site["url"])

    main_wcapi = get_wcapi(site)

    if args.audit:
        output_file = args.audit_file or (
            f"audit_{SITE_ID}_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}.txt"
        )
        audit_store(
            main_wcapi, site, data, output_file,
            source_label=source_label,
            orderboard_store_id=ob_store_id,
            orderboard_url=ob_url,
        )
        return

    if args.fix:
        output_file = args.fix_file or (
            f"fix_{SITE_ID}_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}.txt"
        )
        woo_attrs = preflight(main_wcapi, data)
        filter_skus = _parse_audit_skus(args.from_audit) if args.from_audit else None
        if filter_skus:
            logger.info("Targeting fix to %d SKU(s) from audit report.", len(filter_skus))
        fix_store(
            main_wcapi, site, data, woo_attrs,
            color_mappings, fit_mappings, catalog_colors,
            output_file,
            source_label=source_label,
            orderboard_store_id=ob_store_id,
            orderboard_url=ob_url,
            filter_skus=filter_skus,
        )
        return

    # Pre-create all attributes and terms before threads start
    woo_attrs = preflight(main_wcapi, data)

    # When fetching from the API, "built" is not present — all returned products are treated as ready.
    # When using a products.json file, "built" must be True to include the product.
    buildable = [p for p in products if (args.api or p.get("built")) and p.get("variations")]
    if args.filter_skus:
        allowed = {s.strip().upper() for s in args.filter_skus.split(",")}
        buildable = [p for p in buildable if p["sku"].strip().upper() in allowed]
        logger.info("Filtered to %d product(s) by --filter-skus", len(buildable))
    logger.info("Uploading %d products with %d workers...", len(buildable), MAX_WORKERS)

    def worker(product):
        wcapi = get_wcapi(site)  # one client per thread
        upload_product(wcapi, site, woo_attrs, product, color_mappings, fit_mappings, catalog_colors, force=args.force, square_pad=args.square_pad)
        return product["name"]

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {executor.submit(worker, p): p["name"] for p in buildable}
        for future in as_completed(futures):
            try:
                future.result()
            except Exception as e:
                logger.error("Upload failed for '%s': %s", futures[future], e)

    # Post-upload housekeeping (single-threaded, order matters)
    logger.info("Running post-upload tasks...")
    reorder_sizes(main_wcapi)
    update_color_swatches(main_wcapi, site, color_mappings)

    logger.info("Upload complete!")


if __name__ == "__main__":
    main()
