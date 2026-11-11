variable "project_id" {
  description = "Existing, billing-enabled GCP project approved for the disposable trial."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.project_id))
    error_message = "Use a valid GCP project ID."
  }
}

variable "name" {
  description = "Unique prefix for new resources. Use a different name from the historical trial."
  type        = string
  default     = "rg-rebuild"

  validation {
    condition     = can(regex("^rg-[a-z0-9]([a-z0-9-]{0,18}[a-z0-9])?$", var.name)) && var.name != "rg-trial"
    error_message = "Use a fresh rg- prefixed name with at most 23 characters."
  }
}

variable "zone" {
  description = "One GCP zone. A regional node pool would multiply the requested node count."
  type        = string
  default     = "asia-southeast1-a"

  validation {
    condition     = can(regex("^[a-z]+-[a-z]+[0-9]+-[a-z]$", var.zone))
    error_message = "Use a zonal location, such as asia-southeast1-a."
  }
}

variable "operator_cidr" {
  description = "Approved operator's public IPv4 address as a /32 for the Kubernetes API endpoint."
  type        = string

  validation {
    condition     = can(cidrnetmask(var.operator_cidr)) && endswith(var.operator_cidr, "/32")
    error_message = "Use exactly one approved IPv4 address with a /32 suffix."
  }
}

variable "node_count" {
  description = "Number of trial compute nodes. Keep zero outside a timed verification window."
  type        = number
  default     = 0

  validation {
    condition     = contains([0, 1, 2], var.node_count)
    error_message = "The disposable zonal pool supports zero, one, or two nodes."
  }
}
