"""
Equipment models for API requests and responses.
"""
from datetime import datetime
from typing import List, Optional, Literal
from pydantic import BaseModel, Field


class EquipmentBase(BaseModel):
    """Base equipment model with common fields."""
    inv_no: str = Field(..., description="Inventory number")
    serial_no: Optional[str] = Field(None, description="Serial number")
    hw_serial_no: Optional[str] = Field(None, description="Hardware serial number")
    part_no: Optional[str] = Field(None, description="Part number")
    type_no: Optional[int] = Field(None, description="Equipment type ID")
    type_name: Optional[str] = Field(None, description="Equipment type name")
    model_no: Optional[int] = Field(None, description="Model ID")
    model_name: Optional[str] = Field(None, description="Model name")
    vendor_no: Optional[int] = Field(None, description="Vendor ID")
    vendor_name: Optional[str] = Field(None, description="Vendor name")
    status_no: Optional[int] = Field(None, description="Status ID")
    status_name: Optional[str] = Field(None, description="Status name")
    empl_no: Optional[int] = Field(None, description="Employee ID")
    employee_name: Optional[str] = Field(None, description="Employee name")
    employee_dept: Optional[str] = Field(None, description="Employee department")
    employee_email: Optional[str] = Field(None, description="Employee email")
    branch_no: Optional[int | str] = Field(None, description="Branch ID")
    branch_name: Optional[str] = Field(None, description="Branch name")
    loc_no: Optional[int | str] = Field(None, description="Location ID")
    location_name: Optional[str] = Field(None, description="Location name")
    date_create: Optional[datetime] = Field(None, description="Creation date")
    date_last_modify: Optional[datetime] = Field(None, description="Last modification date")
    description: Optional[str] = Field(None, description="Description")


class EmployeeSummary(BaseModel):
    """Summary of an employee with equipment count."""
    owner_no: int = Field(..., description="Employee ID")
    name: str = Field(..., description="Employee full name")
    department: Optional[str] = Field(None, description="Department")
    email: Optional[str] = Field(None, description="Email address")
    equipment_count: int = Field(0, description="Number of equipment items")


class EquipmentSearchResponse(BaseModel):
    """Response model for equipment search."""
    found: bool = Field(..., description="Whether equipment was found")
    equipment: List[EquipmentBase] = Field(default_factory=list, description="List of equipment")


class EmployeeSearchResponse(BaseModel):
    """Response model for employee search."""
    employees: List[EmployeeSummary] = Field(default_factory=list)
    total: int = Field(..., description="Total number of results")
    page: int = Field(..., description="Current page number")
    pages: int = Field(..., description="Total number of pages")


class EquipmentListResponse(BaseModel):
    """Response model for paginated equipment list."""
    equipment: List[EquipmentBase] = Field(default_factory=list)
    total: int = Field(..., description="Total number of equipment")
    page: int = Field(..., description="Current page number")
    pages: int = Field(..., description="Total number of pages")


class Branch(BaseModel):
    """Branch/location information."""
    id: int | str = Field(..., description="Branch ID")
    name: str = Field(..., description="Branch name")


class Location(BaseModel):
    """Location information."""
    loc_no: int | str = Field(..., description="Location ID")
    loc_name: str = Field(..., description="Location name")


class EquipmentType(BaseModel):
    """Equipment type information."""
    ci_type: Optional[int] = Field(None, description="Category ID")
    type_no: int = Field(..., description="Type ID")
    type_name: str = Field(..., description="Type name")


class EquipmentStatus(BaseModel):
    """Equipment status information."""
    status_no: int = Field(..., description="Status ID")
    status_name: str = Field(..., description="Status name")


class EquipmentCreateRequest(BaseModel):
    """Create equipment payload for ITEMS insert."""
    serial_no: str = Field(..., min_length=1, description="Serial number")
    employee_name: str = Field(..., min_length=2, description="Employee full name")
    branch_no: int | str = Field(..., description="Branch ID")
    loc_no: int | str = Field(..., description="Location ID")
    type_no: int = Field(..., description="Equipment type ID")
    status_no: int = Field(..., description="Equipment status ID")
    model_name: Optional[str] = Field(None, description="Model name (used when model_no is missing)")
    model_no: Optional[int] = Field(None, description="Model ID")
    employee_no: Optional[int] = Field(None, description="Employee OWNER_NO")
    employee_dept: Optional[str] = Field(None, description="Department for creating new employee")
    hw_serial_no: Optional[str] = Field(None, description="Hardware serial number")
    part_no: Optional[str] = Field(None, description="Part number")
    description: Optional[str] = Field(None, description="Description")
    ip_address: Optional[str] = Field(None, description="IP address")


class EquipmentCreateResponse(BaseModel):
    """Create equipment operation result."""
    success: bool = Field(..., description="Creation status")
    item_id: Optional[int] = Field(None, description="Created ITEMS.ID")
    inv_no: Optional[str] = Field(None, description="Generated inventory number")
    created_owner: bool = Field(False, description="Whether owner was created")
    created_model: bool = Field(False, description="Whether model was created")
    message: str = Field(..., description="Operation message")


class ConsumableCreateRequest(BaseModel):
    """Create consumable payload for ITEMS insert (CI_TYPE=4)."""
    branch_no: int | str = Field(..., description="Branch ID")
    loc_no: int | str = Field(..., description="Location ID")
    type_no: int = Field(..., description="Consumable type ID")
    qty: int = Field(..., ge=1, description="Quantity to add")
    model_name: Optional[str] = Field(None, description="Model name when model_no is not provided")
    model_no: Optional[int] = Field(None, description="Model ID")
    status_no: Optional[int] = Field(None, description="Status ID; default is resolved automatically")
    part_no: Optional[str] = Field(None, description="Part number")
    description: Optional[str] = Field(None, description="Description")


class ConsumableCreateResponse(BaseModel):
    """Create consumable operation result."""
    success: bool = Field(..., description="Creation status")
    item_id: Optional[int] = Field(None, description="Created ITEMS.ID")
    inv_no: Optional[str] = Field(None, description="Generated inventory number")
    created_model: bool = Field(False, description="Whether model was created")
    message: str = Field(..., description="Operation message")


class ConsumableLookupItem(BaseModel):
    """Consumable candidate for work operations."""
    id: int = Field(..., description="ITEMS.ID")
    inv_no: Optional[str] = Field(None, description="Inventory number")
    type_no: Optional[int] = Field(None, description="TYPE_NO")
    type_name: Optional[str] = Field(None, description="Type name")
    model_no: Optional[int] = Field(None, description="MODEL_NO")
    model_name: Optional[str] = Field(None, description="Model name")
    qty: int = Field(..., description="Available quantity")
    branch_no: Optional[int | str] = Field(None, description="Branch number")
    branch_name: Optional[str] = Field(None, description="Branch name")
    loc_no: Optional[int | str] = Field(None, description="Location number")
    location_name: Optional[str] = Field(None, description="Location name")
    part_no: Optional[str] = Field(None, description="Part number")
    description: Optional[str] = Field(None, description="Description")


class ConsumableConsumeRequest(BaseModel):
    """Decrease consumable quantity by qty."""
    item_id: Optional[int] = Field(None, description="ITEMS.ID")
    inv_no: Optional[str] = Field(None, description="Inventory number")
    qty: int = Field(1, ge=1, description="Quantity to consume")
    reason: Optional[str] = Field(None, description="Operation reason")


class ConsumableConsumeResponse(BaseModel):
    """Result of consumable stock decrease."""
    success: bool = Field(..., description="Operation status")
    item_id: Optional[int] = Field(None, description="ITEMS.ID")
    inv_no: Optional[str] = Field(None, description="Inventory number")
    qty_old: Optional[int] = Field(None, description="Quantity before update")
    qty_new: Optional[int] = Field(None, description="Quantity after update")
    message: str = Field(..., description="Operation message")


class ConsumableQtyUpdateRequest(BaseModel):
    """Set exact consumable quantity."""
    item_id: Optional[int] = Field(None, description="ITEMS.ID")
    inv_no: Optional[str] = Field(None, description="Inventory number")
    qty: int = Field(..., ge=0, description="Target quantity")


class ConsumableQtyUpdateResponse(BaseModel):
    """Result of consumable stock set operation."""
    success: bool = Field(..., description="Operation status")
    item_id: Optional[int] = Field(None, description="ITEMS.ID")
    inv_no: Optional[str] = Field(None, description="Inventory number")
    qty_old: Optional[int] = Field(None, description="Quantity before update")
    qty_new: Optional[int] = Field(None, description="Quantity after update")
    message: str = Field(..., description="Operation message")


class TransferItemResult(BaseModel):
    """Result of transfer operation for a single item."""
    inv_no: str = Field(..., description="Inventory number")
    serial_no: Optional[str] = Field(None, description="Serial number")
    old_employee_no: Optional[int] = Field(None, description="Old employee ID")
    old_employee_name: Optional[str] = Field(None, description="Old employee name")
    new_employee_no: int = Field(..., description="New employee ID")
    new_employee_name: str = Field(..., description="New employee name")
    branch_no: Optional[int | str] = Field(None, description="Final branch ID")
    loc_no: Optional[int | str] = Field(None, description="Final location ID")
    branch_name: Optional[str] = Field(None, description="Final branch name")
    location_name: Optional[str] = Field(None, description="Final location name")
    type_name: Optional[str] = Field(None, description="Type name")
    model_name: Optional[str] = Field(None, description="Model name")
    part_no: Optional[str] = Field(None, description="Part number")
    hist_id: Optional[int] = Field(None, description="History record ID")


class TransferFailedItem(BaseModel):
    """Failed transfer item."""
    inv_no: str = Field(..., description="Inventory number")
    error: str = Field(..., description="Error reason")


class TransferActInfo(BaseModel):
    """Generated transfer act metadata."""
    act_id: str = Field(..., description="Act identifier")
    old_employee: str = Field(..., description="Old employee name")
    equipment_count: int = Field(..., description="Equipment count in act")
    file_name: str = Field(..., description="Generated file name")
    file_type: Literal["pdf", "docx"] = Field(..., description="File extension")


class TransferExecuteRequest(BaseModel):
    """Transfer request for one or multiple inventory items."""
    inv_nos: List[str] = Field(..., min_length=1, description="Inventory numbers")
    new_employee: str = Field(..., min_length=2, description="Target employee full name")
    new_employee_no: Optional[int] = Field(None, description="Optional target employee OWNER_NO")
    new_employee_dept: Optional[str] = Field(None, description="Optional target employee department when creating new owner")
    branch_no: Optional[int | str] = Field(None, description="Optional target BRANCH_NO")
    loc_no: Optional[int | str] = Field(None, description="Optional target LOC_NO")
    comment: Optional[str] = Field(None, description="Optional transfer comment")


class TransferExecuteResponse(BaseModel):
    """Transfer operation response."""
    success_count: int = Field(..., description="Successfully transferred items")
    failed_count: int = Field(..., description="Failed transfers")
    transferred: List[TransferItemResult] = Field(default_factory=list, description="Transferred items")
    failed: List[TransferFailedItem] = Field(default_factory=list, description="Failed items")
    acts: List[TransferActInfo] = Field(default_factory=list, description="Generated acts")
    upload_reminder_created: bool = Field(False, description="Whether upload reminder task was created")
    upload_reminder_task_id: Optional[str] = Field(None, description="Hub task id for upload reminder")
    upload_reminder_id: Optional[str] = Field(None, description="Persistent reminder id")
    upload_reminder_warning: Optional[str] = Field(None, description="Reminder creation warning")
    upload_reminder_controller_username: Optional[str] = Field(None, description="Resolved reminder controller username")
    upload_reminder_controller_fallback_used: bool = Field(False, description="Whether controller fallback was used")


class TransferEmailRequest(BaseModel):
    """Request to send generated transfer acts by email."""
    act_ids: List[str] = Field(..., min_length=1, description="Act IDs to send")
    mode: Literal["old", "new", "manual", "employee"] = Field(
        ..., description="Email delivery mode"
    )
    manual_email: Optional[str] = Field(None, description="Manual recipient email")
    owner_no: Optional[int] = Field(None, description="Recipient owner number for employee mode")


class TransferEmailResult(BaseModel):
    """Email sending result."""
    success_count: int = Field(..., description="Successfully sent emails")
    failed_count: int = Field(..., description="Failed emails")
    errors: List[str] = Field(default_factory=list, description="Error list")


class UploadedActResolvedItem(BaseModel):
    """Resolved equipment item from parsed act draft."""
    item_id: int = Field(..., description="ITEMS.ID")
    inv_no: Optional[str] = Field(None, description="Inventory number")
    serial_no: Optional[str] = Field(None, description="Serial number")
    model_name: Optional[str] = Field(None, description="Model name")
    employee_name: Optional[str] = Field(None, description="Current employee")
    branch_name: Optional[str] = Field(None, description="Branch name")
    location_name: Optional[str] = Field(None, description="Location name")


class UploadedActDraftResponse(BaseModel):
    """Parsed uploaded act draft."""
    draft_id: str = Field(..., description="Draft identifier")
    file_name: str = Field(..., description="Uploaded file name")
    document_title: str = Field(..., description="Detected document title")
    from_employee: str = Field(default="", description="Detected old employee")
    to_employee: str = Field(default="", description="Detected new employee")
    doc_date: Optional[str] = Field(None, description="Detected document date (YYYY-MM-DD)")
    equipment_inv_nos: List[str] = Field(default_factory=list, description="Detected inventory numbers")
    resolved_items: List[UploadedActResolvedItem] = Field(default_factory=list, description="Resolved equipment rows")
    warnings: List[str] = Field(default_factory=list, description="Parsing/validation warnings")


class UploadedActCommitRequest(BaseModel):
    """Commit request for parsed act draft."""
    draft_id: str = Field(..., min_length=1, description="Draft identifier")
    document_title: Optional[str] = Field(None, description="Final document title")
    from_employee: Optional[str] = Field(None, description="Old employee")
    to_employee: Optional[str] = Field(None, description="New employee")
    doc_date: Optional[str] = Field(None, description="Document date YYYY-MM-DD")
    equipment_inv_nos: Optional[List[str]] = Field(None, description="Final inventory numbers list")
    source_task_id: Optional[str] = Field(None, description="Optional hub task id for reminder binding")
    reminder_id: Optional[str] = Field(None, description="Optional reminder id for explicit binding")


class UploadedActCommitResponse(BaseModel):
    """Commit result for uploaded act draft."""
    success: bool = Field(..., description="Commit status")
    doc_no: int = Field(..., description="Created DOCS.DOC_NO")
    doc_number: str = Field(..., description="Created DOCS.DOC_NUMBER")
    file_no: int = Field(..., description="Created FILES.FILE_NO")
    linked_item_ids: List[int] = Field(default_factory=list, description="Linked ITEMS.ID list")
    linked_inv_nos: List[str] = Field(default_factory=list, description="Linked inventory numbers")
    message: str = Field(..., description="Operation message")
    reminder_status: Optional[str] = Field(None, description="Reminder resolution status")
    reminder_task_id: Optional[str] = Field(None, description="Bound reminder task id")
    reminder_id: Optional[str] = Field(None, description="Bound reminder id")
    reminder_pending_groups: int = Field(0, description="Remaining pending groups in reminder")
    reminder_warning: Optional[str] = Field(None, description="Reminder resolution warning")


class TransferActReminderGroupResponse(BaseModel):
    """One pending/completed reminder group."""
    id: str = Field(..., description="Reminder group id")
    generated_act_id: Optional[str] = Field(None, description="Generated act id")
    old_employee_name: str = Field(..., description="Old employee name")
    inv_nos: List[str] = Field(default_factory=list, description="Exact INV_NO list")
    equipment_count: int = Field(..., description="Equipment count")
    matched_doc_no: Optional[int] = Field(None, description="Matched DOC_NO")
    matched_doc_number: Optional[str] = Field(None, description="Matched DOC_NUMBER")
    completed_at: Optional[str] = Field(None, description="Completion timestamp")


class TransferActReminderResponse(BaseModel):
    """Persistent transfer act reminder context."""
    reminder_id: str = Field(..., description="Reminder id")
    task_id: str = Field(..., description="Hub task id")
    db_id: Optional[str] = Field(None, description="Database id")
    assignee_user_id: int = Field(..., description="Assignee user id")
    controller_user_id: int = Field(..., description="Controller user id")
    created_by_user_id: int = Field(..., description="Creator user id")
    new_employee_no: Optional[str] = Field(None, description="Target employee number")
    new_employee_name: str = Field(..., description="Target employee name")
    status: str = Field(..., description="Reminder status")
    created_at: Optional[str] = Field(None, description="Created timestamp")
    updated_at: Optional[str] = Field(None, description="Updated timestamp")
    completed_at: Optional[str] = Field(None, description="Completed timestamp")
    pending_groups_total: int = Field(0, description="Pending groups count")
    completed_groups_total: int = Field(0, description="Completed groups count")
    pending_groups: List[TransferActReminderGroupResponse] = Field(default_factory=list, description="Pending groups")
    completed_groups: List[TransferActReminderGroupResponse] = Field(default_factory=list, description="Completed groups")
    upload_url: str = Field(..., description="Deep-link to upload act UI")


class UploadedActEmailSendRequest(BaseModel):
    """Send uploaded act by email."""
    doc_no: int = Field(..., description="DOCS.DOC_NO for attached act")
    mode: Literal["auto", "selected"] = Field(
        ..., description="auto - from/to employees; selected - explicit owner_nos"
    )
    from_employee: Optional[str] = Field(None, description="Sender employee full name from act")
    to_employee: Optional[str] = Field(None, description="Recipient employee full name from act")
    owner_nos: List[int] = Field(default_factory=list, description="Selected OWNER_NO list")
    subject: Optional[str] = Field(None, description="Email subject")
    body: Optional[str] = Field(None, description="Email body")


class UploadedActEmailRecipientStatus(BaseModel):
    """Per-recipient status for uploaded act email send."""
    owner_no: Optional[int] = Field(None, description="OWNER_NO if resolved")
    employee_name: str = Field(..., description="Recipient display name")
    email: Optional[str] = Field(None, description="Resolved email")
    status: Literal["sent", "missing_email", "not_found", "error"] = Field(
        ..., description="Recipient delivery status"
    )
    detail: Optional[str] = Field(None, description="Status details")


class UploadedActEmailSendResponse(BaseModel):
    """Uploaded act email sending result."""
    doc_no: int = Field(..., description="DOC_NO")
    subject: str = Field(..., description="Final email subject")
    success_count: int = Field(..., description="Successfully sent count")
    failed_count: int = Field(..., description="Failed count")
    recipients: List[UploadedActEmailRecipientStatus] = Field(
        default_factory=list, description="Per-recipient statuses"
    )
