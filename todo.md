# sync

[X] Verify if `computed` in sync with client

# signe

[X] effect not works if package signal is not same

# rooms

[X] Create shard
[X] Create world
    - [] Have a KV to store rooms and shards
    - [] Transfer state room to room with world authority
    - [] Manage many world. For moment, we use "default" name
    - [] Update shard pool when minShards is changed
    - [X] Add guard with token to manage world
    - [X] Fix: Shard foward ctx request