terraform {
  required_version = "~> 1.13"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = local.region
}

locals {
  region       = trimsuffix(var.zone, substr(var.zone, -2, 2))
  subnet_cidr  = "10.40.0.0/24"
  pod_cidr     = "10.44.0.0/16"
  service_cidr = "10.45.0.0/20"
}

resource "google_project_service" "required" {
  for_each = toset([
    "artifactregistry.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "compute.googleapis.com",
    "container.googleapis.com",
    "iam.googleapis.com",
  ])

  service            = each.value
  disable_on_destroy = false
}

resource "google_compute_network" "trial" {
  name                    = var.name
  auto_create_subnetworks = false

  depends_on = [google_project_service.required["compute.googleapis.com"]]
}

resource "google_compute_subnetwork" "trial" {
  name                     = var.name
  network                  = google_compute_network.trial.id
  ip_cidr_range            = local.subnet_cidr
  private_ip_google_access = true

  secondary_ip_range {
    range_name    = "pods"
    ip_cidr_range = local.pod_cidr
  }

  secondary_ip_range {
    range_name    = "services"
    ip_cidr_range = local.service_cidr
  }
}

resource "google_compute_router" "trial" {
  name    = var.name
  network = google_compute_network.trial.id
}

resource "google_compute_router_nat" "trial" {
  name                               = var.name
  router                             = google_compute_router.trial.name
  nat_ip_allocate_option             = "AUTO_ONLY"
  source_subnetwork_ip_ranges_to_nat = "LIST_OF_SUBNETWORKS"

  subnetwork {
    name                    = google_compute_subnetwork.trial.id
    source_ip_ranges_to_nat = ["ALL_IP_RANGES"]
  }
}

resource "google_compute_address" "edge" {
  name         = "${var.name}-edge"
  address_type = "EXTERNAL"

  depends_on = [google_project_service.required["compute.googleapis.com"]]
}

resource "google_artifact_registry_repository" "app" {
  location      = local.region
  repository_id = var.name
  format        = "DOCKER"

  depends_on = [google_project_service.required["artifactregistry.googleapis.com"]]
}

resource "google_service_account" "nodes" {
  account_id   = "${var.name}-nodes"
  display_name = "ReleaseGuard trial GKE nodes"

  depends_on = [google_project_service.required["iam.googleapis.com"]]
}

resource "google_project_iam_member" "nodes" {
  project = var.project_id
  role    = "roles/container.defaultNodeServiceAccount"
  member  = google_service_account.nodes.member

  depends_on = [google_project_service.required["cloudresourcemanager.googleapis.com"]]
}

resource "google_artifact_registry_repository_iam_member" "nodes" {
  location   = local.region
  repository = google_artifact_registry_repository.app.name
  role       = "roles/artifactregistry.reader"
  member     = google_service_account.nodes.member
}

resource "google_container_cluster" "trial" {
  name                     = var.name
  location                 = var.zone
  network                  = google_compute_network.trial.id
  subnetwork               = google_compute_subnetwork.trial.id
  remove_default_node_pool = true
  initial_node_count       = 1
  deletion_protection      = false
  datapath_provider        = "ADVANCED_DATAPATH"

  # GKE creates a bootstrap node pool before Terraform removes it.
  node_config {
    service_account = google_service_account.nodes.email
    oauth_scopes    = ["https://www.googleapis.com/auth/cloud-platform"]
  }

  release_channel {
    channel = "REGULAR"
  }

  workload_identity_config {
    workload_pool = "${var.project_id}.svc.id.goog"
  }

  ip_allocation_policy {
    cluster_secondary_range_name  = "pods"
    services_secondary_range_name = "services"
  }

  private_cluster_config {
    enable_private_nodes    = true
    enable_private_endpoint = false
  }

  master_authorized_networks_config {
    cidr_blocks {
      cidr_block   = var.operator_cidr
      display_name = "approved-operator"
    }
    gcp_public_cidrs_access_enabled = false
  }

  depends_on = [
    google_project_service.required["container.googleapis.com"],
    google_compute_router_nat.trial,
    google_project_iam_member.nodes,
  ]
}

resource "google_container_node_pool" "trial" {
  name       = "default-pool"
  location   = var.zone
  cluster    = google_container_cluster.trial.name
  node_count = var.node_count

  management {
    auto_repair  = true
    auto_upgrade = true
  }

  node_config {
    machine_type    = "e2-standard-2"
    disk_type       = "pd-standard"
    disk_size_gb    = 30
    service_account = google_service_account.nodes.email
    oauth_scopes    = ["https://www.googleapis.com/auth/cloud-platform"]

    workload_metadata_config {
      mode = "GKE_METADATA"
    }
  }

  depends_on = [
    google_project_iam_member.nodes,
    google_artifact_registry_repository_iam_member.nodes,
  ]
}

output "deployment_inputs" {
  description = "Nonsecret inputs for the existing Kubernetes renderers and image publisher."
  value = {
    cluster           = google_container_cluster.trial.name
    zone              = var.zone
    public_ip         = google_compute_address.edge.address
    pod_cidr          = local.pod_cidr
    storage_class     = "standard-rwo"
    docker_repository = "${local.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.app.repository_id}"
  }
}
