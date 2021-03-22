---
title: Introduction
nav_order: 1
layout: default
---

# Introduction

ShareDB is a full-stack library for realtime JSON document collaboration. It provides a Node.js server for coordinating and committing edits from multiple clients. It also provides a JavaScript client for manipulating documents, which can be run either in Node.js or in the browser.

<!-- TODO: Link to types page -->
The underlying conflict management is handled through [Operational Transformation (OT)](https://en.wikipedia.org/wiki/Operational_transformation). The implementation of this strategy is delegated to ShareDB's type plugins.

## Features

 - Realtime synchronization of any JSON document
 - Concurrent multi-user collaboration
 - Synchronous editing API with asynchronous eventual consistency
 - Realtime query subscriptions
 <!-- TODO: Link to DB drivers -->
 - Simple integration with any database
 <!-- TODO: Link to pub/sub -->
 - Horizontally scalable with pub/sub integration
 - Projections to select desired fields from documents and operations
 - Middleware for implementing access control and custom extensions
 - Ideal for use in browsers or on the server
 - Offline change syncing upon reconnection
 - In-memory implementations of database and pub/sub for unit testing
 <!-- TODO: Link to document versioning -->
 - Access to historic document versions
 <!-- TODO: Link to Presence -->
 - Realtime user presence syncing
