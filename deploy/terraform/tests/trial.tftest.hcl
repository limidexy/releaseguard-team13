mock_provider "google" {}

variables {
  project_id    = "rg-example-project"
  operator_cidr = "203.0.113.10/32"
}

run "default_plan" {
  command = plan

  assert {
    condition     = google_container_node_pool.trial.node_count == 0 && google_container_cluster.trial.location == "asia-southeast1-a"
    error_message = "The default must be a single-zone trial with zero workload nodes."
  }

  assert {
    condition     = google_container_cluster.trial.private_cluster_config[0].enable_private_nodes && google_container_cluster.trial.datapath_provider == "ADVANCED_DATAPATH"
    error_message = "Private workload nodes and NetworkPolicy enforcement must remain enabled."
  }

  assert {
    condition     = output.deployment_inputs.pod_cidr == "10.44.0.0/16" && output.deployment_inputs.storage_class == "standard-rwo"
    error_message = "The workload renderer needs the matching pod range and storage class."
  }
}

run "two_node_trial" {
  command = plan

  variables {
    node_count = 2
  }

  assert {
    condition     = google_container_node_pool.trial.node_count == 2 && google_container_node_pool.trial.node_config[0].machine_type == "e2-standard-2"
    error_message = "The timed trial must use two e2-standard-2 nodes."
  }
}
