# User Type 4 Address Update Guide (Frontend)

This document covers address operations when using:

- `PUT /api/user/update/:id` (dashboard/admin user update endpoint)

It is focused on type `4` users.

## Auth

- Send `Authorization: Bearer <token>`

## 1) Add a New Extra Address

Use either `add_new_address: true` or `is_additional_address: true`.

Required fields:

- `add_new_address` (or `is_additional_address`) = `true`
- `address` (non-empty string)
- `state_id` (valid ObjectId)
- `city_id` (valid ObjectId)
- `pincode` (non-empty string)

Optional fields:

- `area_id` (valid ObjectId if sent)
- `contact_name`
- `contact_number`
- `address_status` (boolean, default `true`)

Example:

```json
{
  "add_new_address": true,
  "address": "Flat 12, MG Road",
  "state_id": "6a045a224573f233a6419638",
  "city_id": "6a0561f57b5d4f4321a75eea",
  "pincode": "515154",
  "area_id": "6a056241fda88e16ff54ce64",
  "contact_name": "Tanusha Sharma",
  "contact_number": "9874563215",
  "address_status": true
}
```

## 2) Edit an Existing Address

Do not send `add_new_address` for edit.

Required:

- `address_id` (target address row id)

Updatable fields (send only what you need):

- `address`
- `state_id`
- `city_id`
- `pincode`
- `area_id`
- `contact_name`
- `contact_number`
- `address_status`

Example:

```json
{
  "address_id": "6b1234567890abcd12345678",
  "address": "Updated address line",
  "state_id": "6a045a224573f233a6419638",
  "city_id": "6a0561f57b5d4f4321a75eea",
  "pincode": "515154",
  "area_id": "6a056241fda88e16ff54ce64",
  "contact_name": "Tanusha Sharma",
  "contact_number": "9874563215",
  "address_status": true
}
```

Status-only update example:

```json
{
  "address_id": "6b1234567890abcd12345678",
  "address_status": false
}
```

## 3) Delete Address

Address delete is not supported on `PUT /api/user/update/:id`.

Use mobile address endpoint instead:

- `DELETE /api/mobile/user/addresses/:addressId`

## Important Notes (Current Backend Behavior)

When request is specifically for add-extra-address flow (`add_new_address`/`is_additional_address` = `true`), these primary user fields are not required in update:

- `date_of_birth`
- `gender`
- `users.address`
- `users.state_id`
- `users.city_id`
- `users.pincode`
- `users.profile_url`

Age rule:

- 18+ DOB validation is enforced only for partner users (`type = 2`), not for type `4`.
