const getDocuementStatus = (populatedPartnerDocument) => {
    let status;
    for (const document of populatedPartnerDocument) {
        if (document.verification_status === 1 && document.document_id.is_optional === false) {
            status = 1;
            break;
        } else if (document.verification_status === 3 && document.document_id.is_optional === false) {
            status = 3;
        }
    }
    return status;
};
module.exports = {getDocuementStatus}